/**
 * 把编译后的后端 + 生产 node_modules 打成一份 asar。
 * extraResources 只拷这一份归档，避免 Windows 上拷两万个小文件。
 *
 * Windows 上 npm 常用 junction。若跟随链接扫到仓库根目录，文件数会涨到上百万并 OOM。
 * 只收录 src/package 以内的真实文件，不跟随指向包外的链接。
 */
import { createPackageFromFiles } from '@electron/asar'
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/package')
const srcReal = realpathSync(src)
const outDir = join(root, 'build')
const dest = join(outDir, 'tunmo-backend.asar')
const unpacked = `${dest}.unpacked`
const maxFiles = 80_000

const skipTop = new Set(['vendor', 'src', 'test', 'docs', 'scripts', 'node_modules/.bin'])

function posixRel(rel) {
  return rel.replaceAll('\\', '/')
}

function skip(rel) {
  const posix = posixRel(rel)
  if (!posix || posix === '.' || posix.startsWith('../') || posix === '..') return true
  const top = posix.split('/')[0]
  if (skipTop.has(top)) return true
  if (posix === '.env' || posix.startsWith('.env.')) return true
  if (posix.includes('/.bin/') || posix.startsWith('.bin/') || posix.endsWith('/.bin')) return true
  if (posix.endsWith('.map') || posix.endsWith('.d.ts')) return true
  if (posix.startsWith('node_modules/@fastify/swagger')) return true
  return false
}

function insideSrc(abs) {
  let cur = resolve(abs)
  let base = srcReal
  if (process.platform === 'win32') {
    cur = cur.toLowerCase()
    base = base.toLowerCase()
  }
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return cur === base || cur.startsWith(prefix)
}

function collect(dir, files, visited) {
  let realDir
  try {
    realDir = realpathSync(dir)
  } catch {
    return
  }
  if (!insideSrc(realDir) || visited.has(realDir)) return
  visited.add(realDir)

  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const name of entries) {
    const full = join(dir, name)
    const rel = relative(src, full)
    if (skip(rel)) continue

    let lst
    try {
      lst = lstatSync(full)
    } catch {
      continue
    }

    if (lst.isSymbolicLink()) {
      let real
      try {
        real = realpathSync(full)
      } catch {
        continue
      }
      if (!insideSrc(real)) continue
      let target
      try {
        target = lstatSync(real)
      } catch {
        continue
      }
      if (target.isDirectory()) collect(real, files, visited)
      else if (target.isFile()) files.push(real)
      continue
    }

    if (lst.isDirectory()) {
      collect(full, files, visited)
      continue
    }
    if (lst.isFile()) files.push(full)
  }
}

if (!existsSync(join(src, 'dist/main.js'))) {
  throw new Error('缺少 src/package/dist/main.js，请先执行 backend bundle')
}
if (!existsSync(join(src, 'node_modules/@earendil-works/pi-coding-agent'))) {
  throw new Error('缺少 Pi 依赖，请先在 src/package 执行 npm install')
}

mkdirSync(outDir, { recursive: true })
try {
  if (existsSync(dest)) rmSync(dest, { force: true })
  if (existsSync(unpacked)) rmSync(unpacked, { recursive: true, force: true })
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code !== 'EPERM') throw err
  console.warn('[backend:asar] 旧 asar 正在被占用，将覆盖写入')
}

console.log(`[backend:asar] scanning ${src}`)
const files = []
collect(src, files, new Set())
if (files.length > maxFiles) {
  throw new Error(
    `asar 文件数 ${files.length} 超过 ${maxFiles}，多半跟丢了目录。请检查 src/package 是否被 junction 链到仓库根目录`
  )
}
if (!files.some((file) => posixRel(file).endsWith('/dist/main.js'))) {
  throw new Error('asar 文件列表里没有 dist/main.js')
}

console.log(`[backend:asar] packing ${files.length} files -> ${dest}`)
await createPackageFromFiles(src, dest, files, undefined, {
  unpack: '{**/*.node,**/*.wasm,**/*.dll,**/*.dylib,**/*.so}'
})
if (!existsSync(unpacked)) mkdirSync(unpacked, { recursive: true })
console.log(`[backend:asar] wrote ${dest}`)
