# Rui DSH Desktop

Unofficial Windows desktop shell for [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). It launches the official `@deepseek-ai/dsh web` UI inside Electron so you can double-click to run without installing Node.js.

This project is **not affiliated with DeepSeek**. It does not fork or reimplement the official Web UI.

## What it does

- Starts pinned `@deepseek-ai/dsh` on `127.0.0.1` with an ephemeral port
- Stores Harness data in `%USERPROFILE%\.dsh`
- Writes logs to `%APPDATA%\Rui DSH Desktop\logs`
- Adds desktop-only extras around the official UI: window chrome, client/kernel updates, IM channels, session import

## Requirements

- Windows 10/11 x64
- Node.js 22.19+ (development only; the installer bundles the runtime)

## Develop

```bash
npm install
npm start
```

Build a Windows installer:

```bash
npm run dist:win
```

The NSIS package is unsigned. Windows SmartScreen may warn on first run.

## Updates

| Channel | How it updates |
|---|---|
| Desktop client | GitHub Releases (`dcxa521gi/Rui-DSH-Desktop`). Auto-check on startup; an **更新** button appears next to Settings when a newer release exists. |
| Harness kernel `@deepseek-ai/dsh` | Manual check in Settings → Rui Desktop. The update button stays disabled until the package is fully downloaded and verified. |
| IM plugins | Per-channel check in the sidebar IM panel. |

## IM

WeChat uses the official Tencent iLink QR flow (`@tencent-weixin/openclaw-weixin`), not an unofficial personal protocol. Telegram uses Bot API. Feishu / WeCom / DingTalk / Discord currently support credentials and test send.

Inbound WeChat / Telegram messages create sessions in a unified IM workspace (configurable in Settings → Rui Desktop).

## Session import

Settings → Rui Desktop → 会话导入 scans `~/.claude` and `~/.codex` jsonl files, then creates sessions in an **导入** workspace. Full transcripts are written as Markdown in that workspace; the conversation gets a summary prompt.

## License

MIT
