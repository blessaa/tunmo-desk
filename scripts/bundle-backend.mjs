/**
 * 把 tunmo-backend 源码打成单个 dist/main.js；npm 依赖仍从 node_modules 加载。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'src/package')
const outfile = join(pkg, 'dist/main.js')

rmSync(join(pkg, 'dist'), { recursive: true, force: true })
mkdirSync(dirname(outfile), { recursive: true })

await esbuild.build({
  absWorkingDir: pkg,
  entryPoints: ['src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  packages: 'external',
  external: [
    '@earendil-works/*',
    '@fastify/swagger',
    '@fastify/swagger-ui'
  ]
})

console.log(`[backend:bundle] wrote ${outfile}`)
