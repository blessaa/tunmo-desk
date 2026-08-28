/**
 * 工作区：系统选目录对话框，以及懒加载一层文件树。
 */
import { dialog } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/** 侧边栏文件树的一个节点。子目录默认不预读，点开再 workspace:tree。 */
export interface FileNode {
  /** 显示名。 */
  name: string
  /** 绝对路径。 */
  path: string
  type: 'file' | 'directory'
  /** 仅根节点第一次会带 children；懒加载后由渲染进程再要。 */
  children?: FileNode[]
}

/** 文件树里跳过的目录名，避免扫 node_modules 卡死。 */
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cursor'])
/** 单个目录最多列出的条目数。 */
const MAX_PER_DIR = 2000

/** 弹出原生「打开文件夹」对话框；取消返回 null。 */
export async function pickWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '打开工作目录',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

/** 列出 root 下一层文件和文件夹（不递归）。 */
export function readTree(root: string): FileNode[] {
  if (!root || !existsSync(root)) return []
  return listDir(root)
}

/**
 * 确认 target 落在 root 之内，防止路径穿越。
 * @returns 解析后的绝对路径
 */
export function assertInsideWorkspace(root: string, target: string): string {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || rel === '') {
    if (resolvedTarget === resolvedRoot) return resolvedTarget
    throw new Error('path outside workspace')
  }
  return resolvedTarget
}

/** 读取某一层目录，文件夹排在文件前面，中文名按拼音排序。 */
function listDir(dir: string): FileNode[] {
  /** 当前层的文件名列表。 */
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }

  /** 组装后的节点。 */
  const nodes: FileNode[] = []
  for (const name of names) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    if (nodes.length >= MAX_PER_DIR) break

    const full = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }

    nodes.push({
      name,
      path: full,
      type: isDir ? 'directory' : 'file'
    })
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
}

/** 从绝对路径取出最后一级目录名，给侧边栏根节点显示。 */
export function displayName(root: string): string {
  return basename(root.replace(/[\\/]+$/, '')) || root.split(sep).pop() || root
}
