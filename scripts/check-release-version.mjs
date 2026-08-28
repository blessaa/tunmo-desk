import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lockPath = join(root, 'package-lock.json')

function fail(message) {
  console.error(`[release:check] ${message}`)
  process.exit(1)
}

const version = String(pkg.version || '').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`package.json version 必须是 x.y.z，当前是 "${version}"`)
}

if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const lockVersion = String(lock.version || '')
  const rootLockVersion = String(lock.packages?.['']?.version || '')
  if (lockVersion !== version) {
    fail(`package-lock.json version 是 ${lockVersion}，和 package.json 的 ${version} 不一致`)
  }
  if (rootLockVersion && rootLockVersion !== version) {
    fail(`package-lock.json packages[""].version 是 ${rootLockVersion}，和 package.json 的 ${version} 不一致`)
  }
}

const rawTag = (process.argv[2] || process.env.GITHUB_REF_NAME || '').trim()
const inCi = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true'

if (inCi && !rawTag) {
  fail('CI 里必须带 git 标签（例如 v0.2.5）')
}

if (rawTag) {
  const tagVersion = rawTag.replace(/^v/, '')
  if (rawTag !== `v${version}` || tagVersion !== version) {
    fail(
      `标签 ${rawTag} 和 package.json 版本 ${version} 不一致。electron-builder 会按 package.json 发到已有 Release，从而覆盖旧安装包。请先改 version 再打标签 v${version}`
    )
  }
}

console.log(`[release:check] ok  version=${version}${rawTag ? `  tag=${rawTag}` : ''}`)
