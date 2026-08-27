import { dialog } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cursor'])
const MAX_PER_DIR = 2000

export async function pickWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '打开工作目录',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

export function readTree(root: string): FileNode[] {
  if (!root || !existsSync(root)) return []
  return listDir(root)
}

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

function listDir(dir: string): FileNode[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }

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

export function displayName(root: string): string {
  return basename(root.replace(/[\\/]+$/, '')) || root.split(sep).pop() || root
}
