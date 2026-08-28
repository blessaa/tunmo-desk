/**
 * 负责把 src/package 里的 tunmo-backend 拉成 Electron 子进程。
 * 开发读仓库目录，安装包读 extraResources 里的 tunmo-backend。
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log'
import { loadSettings } from './settings'

/** 当前已拉起的后端：监听端口 + 子进程句柄。 */
export interface BackendHandle {
  /** 后端监听的本机端口，页面不直连，只给主进程 WebSocket 用。 */
  port: number
  /** tunmo-backend 进程，退出或杀进程时用。 */
  child: ChildProcess
}

/** 全局只保留一个后端进程，避免重复占用端口。 */
let handle: BackendHandle | null = null

/**
 * 解析 tunmo-backend 根目录。
 * 安装包在 resources/tunmo-backend，开发环境在仓库 src/package。
 */
export function backendRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'tunmo-backend')
  return join(__dirname, '../../src/package')
}

/** 返回当前后端端口；还没启动时为 null。 */
export function getBackendPort(): number | null {
  return handle?.port ?? null
}

/**
 * 把设置里的 API Key 转成 Pi 认识的环境变量。
 * 后端会把这些变量传给自己的 Pi 子进程，不经浏览器传递。
 */
function apiKeyEnv(provider: string, apiKey: string): NodeJS.ProcessEnv {
  if (!apiKey) return {}
  switch (provider) {
    case 'openai':
      return { OPENAI_API_KEY: apiKey }
    case 'google':
      return { GOOGLE_API_KEY: apiKey, GEMINI_API_KEY: apiKey, GOOGLE_GENERATIVE_AI_API_KEY: apiKey }
    case 'minimax-cn':
      return { MINIMAX_CN_API_KEY: apiKey }
    case 'minimax':
      return { MINIMAX_API_KEY: apiKey }
    case 'openrouter':
      return { OPENROUTER_API_KEY: apiKey }
    default:
      return { ANTHROPIC_API_KEY: apiKey }
  }
}

/**
 * 决定用哪条命令启动后端。
 * 优先编译产物 dist/main.js；没有则用 tsx 跑源码（仅开发）。
 */
function resolveEntry(root: string): { args: string[]; missing: string } {
  /** 打包/本地 build 后的入口。 */
  const distEntry = join(root, 'dist/main.js')
  /** 后端运行依赖；安装包必须单独 extraResources 拷贝，否则 dist 能找到但进程秒退。 */
  const runtimeDep = join(root, 'node_modules/fastify')
  /** tsx CLI，用来在开发时直接跑 TypeScript。 */
  const tsxCli = join(root, 'node_modules/tsx/dist/cli.mjs')
  /** 后端 TypeScript 入口。 */
  const srcEntry = join(root, 'src/main.ts')
  if (existsSync(distEntry)) {
    if (!existsSync(runtimeDep)) {
      return {
        args: [],
        missing: `tunmo-backend 缺少 node_modules（${runtimeDep}）。安装包 extraResources 需要单独拷贝后端依赖`
      }
    }
    return { args: [distEntry], missing: '' }
  }
  if (existsSync(tsxCli) && existsSync(srcEntry)) return { args: [tsxCli, srcEntry], missing: '' }
  return {
    args: [],
    missing: existsSync(root)
      ? 'tunmo-backend 未构建。请在 src/package 执行 npm install 与 npm run build'
      : `找不到 tunmo-backend：${root}`
  }
}

/** 向系统要一个空闲的 127.0.0.1 端口，避免写死 3000 和本机其它服务冲突。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((err) => {
        if (err) reject(err)
        else if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('无法分配本地端口'))
      })
    })
    server.on('error', reject)
  })
}

/**
 * 等到后端 /health 返回成功，或进程已死、超时则抛错。
 * @param port 刚分配给后端的端口
 * @param child 刚 spawn 出的进程，用来判断是否中途退出
 */
async function waitHealthy(port: number, child: ChildProcess): Promise<void> {
  /** 最多等 20 秒，超时视为启动失败。 */
  const deadline = Date.now() + 20_000
  /** 最近一次失败原因，拼进超时错误方便排查。 */
  let lastError = ''
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`tunmo-backend 进程已退出（code ${child.exitCode}）${lastError ? `：${lastError}` : ''}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`tunmo-backend 启动超时${lastError ? `：${lastError}` : ''}`)
}

/**
 * 启动（或复用）tunmo-backend。
 * 用 Electron 可执行文件 + ELECTRON_RUN_AS_NODE，安装包里不需要再装 Node。
 */
export async function startBackend(): Promise<BackendHandle> {
  if (handle && handle.child.exitCode == null) return handle

  /** 后端根目录：开发是 src/package，安装包是 resources/tunmo-backend。 */
  const root = backendRoot()
  /** 启动参数：node 脚本路径；找不到入口时 missing 为说明文字。 */
  const entry = resolveEntry(root)
  if (!entry.args.length) {
    throw new Error(entry.missing)
  }

  /** 当前桌面端设置，用来填工作目录和模型环境变量。 */
  const settings = loadSettings()
  /** Pi 只允许在这个目录树里跑工具；没打开工作区时用用户主目录。 */
  const cwdRoot = settings.workspacePath || homedir()
  /** 本机回环端口，只给主进程连。 */
  const port = await freePort()
  /** 传给后端进程的环境变量：监听地址、工作区、API Key、模型。 */
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: 'info',
    AUTH_TOKEN: '',
    ALLOWED_ORIGINS: '',
    PI_CWD_ROOT: cwdRoot,
    PI_DEFAULT_CWD: cwdRoot,
    ...apiKeyEnv(settings.provider, settings.apiKey)
  }
  if (settings.provider && settings.modelId) {
    env.PI_PROVIDER = settings.provider
    env.PI_MODEL = settings.modelId
  } else {
    delete env.PI_PROVIDER
    delete env.PI_MODEL
  }

  log.info('[backend] spawn', process.execPath, entry.args.join(' '), `port=${port}`)
  /** 实际的 tunmo-backend 子进程。 */
  const child = spawn(process.execPath, entry.args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    log.info('[backend]', chunk.toString('utf8').trimEnd())
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    log.warn('[backend]', chunk.toString('utf8').trimEnd())
  })
  child.once('exit', (code, signal) => {
    log.info('[backend] exit', code, signal)
    if (handle?.child === child) handle = null
  })

  try {
    await waitHealthy(port, child)
  } catch (err) {
    stopBackend()
    throw err
  }

  handle = { port, child }
  return handle
}

/** 停掉后端。Windows 用 taskkill /T 连 Pi 子进程一起杀掉。 */
export function stopBackend(): void {
  /** 先摘掉全局句柄，避免退出回调里再清一次。 */
  const current = handle
  handle = null
  if (!current) return
  const { child } = current
  if (child.exitCode != null || child.pid == null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}
