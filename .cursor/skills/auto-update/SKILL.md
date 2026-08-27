---
name: auto-update
description: >-
  Configure this Electron desktop app so a new published version prompts the user
  to update. Covers Windows/macOS installers, GitHub/Gitee Release, electron-updater,
  and GitHub Actions. Use when working on 自动更新, electron-builder, electron-updater,
  安装包, Release, packaging, or the publish workflow.
---

# 自动更新

6/7/8都是写在配置里通过git的action流来自动打包发布

桌面端软件在遇到有新版本发布时候会提示我是否更新新版本

## Scope

Items 6 / 7 / 8 of the desktop skeleton:

- 6 Windows/macOS 安装包
- 7 Release (GitHub/Gitee)
- 8 自动更新（发现新版本时询问，不要静默安装）

Do not add a second packaging or update pipeline. Edit the files below.

## Config (source of truth)

| File | Role |
|------|------|
| `config/release.json` | GitHub/Gitee owner/repo, update source, `promptUser` |
| `package.json` `version` + `repository` | App version; GitHub owner/repo for electron-builder publish |
| `electron-builder.yml` | NSIS / DMG+ZIP, `extraResources`, `publish.provider: github` |
| `.github/workflows/release.yml` | Tag `v*.*.*` → Windows + macOS build → GitHub Release → optional Gitee |

Before the first real release, replace `YOUR_GITHUB_OWNER` / `YOUR_GITEE_OWNER` in `config/release.json` and `package.json` `repository` / `homepage`.

`update.autoDownload` must stay `false` and `update.promptUser` must stay `true` unless the user explicitly asks for silent updates.

## Runtime (do not reimplement)

- Main process: `src/main/updater.ts` — `electron-updater`, no auto-download
- Prompt UI: `src/renderer/src/components/UpdateBanner.vue`
- Store: `src/renderer/src/stores/updater.ts`
- Packaged feed config is copied via `electron-builder.yml` `extraResources` → `release.json`

On launch (packaged only) the app checks for updates. If a newer GitHub/Gitee release exists, the banner asks **立即更新** or **稍后**. Download, then **安装并重启**.

Dev (`npm run dev`) skips the check (`updater:dev-skip`).

## Release workflow

1. Bump `package.json` `version`
2. Commit and tag `vX.Y.Z` matching that version
3. Push the tag; Actions runs `build:win` / `build:mac` with `--publish always`
4. electron-builder uploads installers plus `latest.yml` / `latest-mac.yml` (required by electron-updater)
5. If `GITEE_TOKEN` is set, `scripts/mirror-gitee.mjs` creates the Gitee release from `config/release.json`

macOS auto-update needs a signed app; unsigned local builds will not update on macOS.

## Agent rules

- Keep packaging, GitHub/Gitee Release, and the update prompt in these config + Action files
- Do not introduce a custom update HTTP server unless asked
- Do not call `checkForUpdatesAndNotify()` (that skips the in-app yes/no prompt)
- After changing publish URLs or owner/repo, update `config/release.json` and `package.json` `repository` together
