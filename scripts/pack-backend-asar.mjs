/**
 * 把编译后的后端 + 生产 node_modules 打成一份 asar。
 * extraResources 只拷这一份归档，避免 Windows 上拷两万个小文件。
 */
import { createPackageFromFiles } from '@electron/asar'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/package')
const outDir = join(root, 'build')
const dest = join(outDir, 'tunmo-backend.asar')
const unpacked = `${dest}.unpacked`

const skipTop = new Set(['vendor', 'src', 'test', 'docs', 'scripts', 'node_modules/.bin'])

function skip(rel) {
  const posix = rel.replaceAll('\\', '/')
  if (!posix || posix === '.') return true
  const top = posix.split('/')[0]
  if (skipTop.has(top)) return true
  if (posix === '.env' || posix.startsWith('.env.')) return true
  if (posix.includes('/.bin/') || posix.startsWith('.bin/') || posix.endsWith('/.bin')) return true
  if (posix.endsWith('.map') || posix.endsWith('.d.ts')) return true
  if (posix.startsWith('node_modules/@fastify/swagger')) return true
  return false
}

function collect(dir, files) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(src, full)
    if (skip(rel)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) collect(full, files)
    else files.push(full)
  }
}

if (!existsSync(join(src, 'dist/main.js'))) {
  throw new Error('缺少 src/package/dist/main.js，请先执行 backend bundle')
}
if (!existsSync(join(src, 'node_modules/@earendil-works/pi-coding-agent'))) {
  throw new Error('缺少 Pi 依赖，请先在 src/package 执行 npm install')
}

mkdirSync(outDir, { recursive: true })
if (existsSync(dest)) rmSync(dest, { force: true })
if (existsSync(unpacked)) rmSync(unpacked, { recursive: true, force: true })

const files = []
collect(src, files)
if (!files.some((file) => file.replaceAll('\\', '/').endsWith('/dist/main.js'))) {
  throw new Error('asar 文件列表里没有 dist/main.js')
}

console.log(`[backend:asar] packing ${files.length} files -> ${dest}`)
await createPackageFromFiles(src, dest, files, undefined, {
  unpack: '{**/*.node,**/*.wasm,**/*.dll,**/*.dylib,**/*.so}'
})
if (!existsSync(unpacked)) mkdirSync(unpacked, { recursive: true })
console.log(`[backend:asar] wrote ${dest}`)
