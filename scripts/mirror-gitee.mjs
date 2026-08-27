import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'config', 'release.json')

if (!process.env.GITEE_TOKEN) {
  console.log('GITEE_TOKEN not set, skip Gitee mirror')
  process.exit(0)
}

if (!existsSync(configPath)) {
  console.error('missing config/release.json')
  process.exit(1)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const owner = config.gitee?.owner
const repo = config.gitee?.repo
const tag = process.env.TAG

if (!owner || owner.startsWith('YOUR_') || !repo || !tag) {
  console.log('Gitee owner/repo not configured, skip')
  process.exit(0)
}

const token = process.env.GITEE_TOKEN
const body = new URLSearchParams({
  access_token: token,
  tag_name: tag,
  name: tag,
  body: `Synced from GitHub release ${tag}`,
  target_commitish: 'main'
})

const res = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body
})

if (!res.ok) {
  const text = await res.text()
  console.error(`Gitee release failed: ${res.status} ${text}`)
  process.exit(1)
}

console.log(`Gitee release ${tag} created for ${owner}/${repo}`)
console.log('Upload installer assets in Gitee Releases if the API did not attach files.')
