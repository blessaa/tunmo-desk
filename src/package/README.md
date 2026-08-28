# tunmo-backend

`tunmo-backend` 是一个独立的 Node.js + TypeScript 服务，通过 Fastify 提供 WebSocket JSON-RPC 对话接口，并把每个活跃对话映射到隔离的 Pi RPC 子进程。

npm 包固定依赖 `@earendil-works/pi-coding-agent@0.84.1`，默认直接启动依赖中的 RPC entry，不要求用户另外安装全局 `pi`。对应版本的 Pi 运行相关源码保存在 `vendor/pi-main`，用于源码审查、许可证合规和 fork 更新对照。原始 `/Users/mwei_std/Desktop/图墨/pi-main` 不会被修改。

## 已实现能力

- `session.initialize` 协议协商；
- `conversation.create/attach/send/steer/followUp/interrupt/getSnapshot/close`；
- prompt 预检成功后才返回 `accepted`；
- 文本流、最终消息校正、并行工具、队列、retry、compaction 事件映射；
- 仅以 `agent_settled` 作为 Pi 自动续跑完成后的正常结算信号；
- 中断幂等、目标 Run 校验、中断超时强制终止及 runtime 重建；
- Conversation 内单调递增 `seq`、内存 replay buffer、断线快照/重放；
- WebSocket 断开不隐式中断对话；
- 严格 LF-only JSONL，兼容半包、粘包、CRLF 和多字节 UTF-8；
- Bearer 认证、短时一次性 WebSocket ticket、Origin 校验、帧限制和连接限流；
- 慢客户端触发 `resync.required` 并关闭订阅，避免阻塞 Pi stdout；
- 工具输入输出的递归敏感字段脱敏和大小限制；
- 中文 OpenAPI/Swagger，包含请求、响应、快照、事件和错误模型字段说明；
- 结构化生命周期日志，可用 `conversationId/runId/clientRequestId/piCommandId/piSessionId/toolCallId/runtimeEpoch/eventType/seq` 关联一次执行。

当前版本是设计文档所建议的单节点内存实现。运行中的 Pi 子进程不能跨节点迁移；多实例部署应使用 `conversationId` 粘性路由。数据库持久化、Redis 租约和跨节点 durable effect journal 属于设计的阶段三，不在本版本中伪装实现。

## 运行要求

- Node.js `>= 22.19.0`；
- 模型提供方凭证由 Pi 自身配置读取，不经浏览器传入。

安装与检查：

```bash
pnpm install --ignore-scripts
cp .env.example .env
pnpm check
pnpm test
pnpm build
pnpm start
```

从 npm 安装并启动：

```bash
npm install --global tunmo-backend
tunmo-backend
```

也可以作为项目依赖安装：

```bash
npm install tunmo-backend
npx tunmo-backend
```

开发模式：

```bash
pnpm dev
```

## 连接 Pi

默认不需要配置 `PI_RPC_COMMAND` 或 `PI_RPC_ARGS`。服务等价于执行：

```text
node <node_modules>/@earendil-works/pi-coding-agent/dist/rpc-entry.js
```

需要切换到单独构建的新 Pi fork 时，可以显式覆盖：

```dotenv
PI_RPC_COMMAND=pi
PI_RPC_ARGS=["--mode","rpc"]
```

或者直接指定 fork 的构建产物：

```dotenv
PI_RPC_COMMAND=node
PI_RPC_ARGS=["/absolute/path/to/pi-main/packages/coding-agent/dist/cli.js","--mode","rpc"]
```

`PI_RPC_ARGS` 必须是 JSON 字符串数组。服务使用 `spawn(..., {shell: false})`，不会把该值交给 shell 解析。

对话工作目录通过以下配置限制：

```dotenv
PI_CWD_ROOT=/allowed/workspace/root
PI_DEFAULT_CWD=/allowed/workspace/root/default-project
PI_SESSION_DIR=/persistent/pi/sessions
```

客户端请求的 `workingDirectory` 必须已经存在，且其 `realpath` 必须位于 `PI_CWD_ROOT` 内。

### Pi release/fork 更新

1. 在独立目录获取或 fork 新 Pi release；
2. 把 `package.json` 中的 `@earendil-works/pi-coding-agent` 固定到对应版本；
3. 执行 `pnpm install --ignore-scripts` 更新依赖和 lockfile；
4. 执行 `pnpm vendor:pi -- /absolute/path/to/new-pi-main` 同步源码；
5. 执行 `pnpm verify:pi-vendor`，确保运行依赖、vendor 源码和 RPC entry 版本一致；
6. 运行检查、测试，并在测试环境执行真实 provider 的 send、tool、interrupt 和 reconnect 验收。

同步脚本只读取 Pi 目录并重建 `tunmo-backend/vendor/pi-main`，不会修改 Pi fork，也不需要把后端代码合并进 Pi。

## 发布到 npm

发布前执行：

```bash
pnpm check
pnpm test
pnpm pack --dry-run
npm publish
```

`prepack` 会重新构建后端并验证 Pi vendor；`prepublishOnly` 会运行类型检查和测试。当前包名 `tunmo-backend` 在准备阶段未查询到已发布版本，但最终是否可用以实际发布时的 npm registry 为准。

项目自身当前标记为 `UNLICENSED`；公开发布前应根据你的授权意图选择自己的许可证。Pi 源码仍遵循 MIT，完整声明见 `THIRD_PARTY_NOTICES.md` 与 `vendor/pi-main/LICENSE`。

## 配置

完整配置见 `.env.example`。重要生产项：

- `AUTH_TOKEN`：配置后 HTTP 请求需要 `Authorization: Bearer <token>`；未配置仅适合本地开发；
- `ALLOWED_ORIGINS`：允许发起浏览器 WebSocket 的 Origin，多个值用逗号分隔；
- `PI_INTERRUPT_TIMEOUT_MS`：协作式 abort 等待上限；
- `MAX_ACTIVE_PI_PROCESSES`：本节点允许同时持有的 Pi 子进程数，超出的 lazy start 会等待 semaphore；
- `REPLAY_CAPACITY`：每个 Conversation 保留的最近事件数量；
- `MAX_FRAME_BYTES`：HTTP body 与 WebSocket frame 上限；
- `MAX_WS_BUFFERED_BYTES`：慢客户端判定阈值；
- `EXPOSE_THINKING`：默认 `false`，不向普通客户端发送原始 thinking。

Node.js 可直接加载 `.env`：

```bash
node --env-file=.env dist/main.js
```

## Swagger 接口测试

启动后访问：

- Swagger UI：`http://192.168.3.112:3000/documentation`
- OpenAPI JSON：`http://192.168.3.112:3000/api/v1/openapi.json`

Swagger 的 `POST /api/v1/agent/rpc` 与 WebSocket 共用同一个 JSON-RPC dispatcher。建议按以下顺序测试：

1. `conversation.create`；
2. 复制返回的 `conversationId`；
3. `conversation.send`，保存返回的 `runId`；
4. 多次调用 `conversation.getSnapshot` 观察状态；
5. 对活动 Run 调用 `conversation.interrupt`；
6. 使用 `conversation.close` 释放逻辑对话。

HTTP 是无订阅短连接，不会持续接收事件。流式事件和断线重放必须通过 WebSocket 测试。

## WebSocket 协议

入口：

```text
GET /api/v1/agent/ws
Sec-WebSocket-Protocol: tunmo.agent.v1
Authorization: Bearer <AUTH_TOKEN>
```

浏览器可先调用 `POST /api/v1/agent/ws-ticket`，然后连接：

```text
ws://192.168.3.112:3000/api/v1/agent/ws?ticket=<一次性 ticket>
```

连接后的首个请求：

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-init-1",
  "method": "session.initialize",
  "params": {
    "protocolVersion": 1,
    "clientId": "web-client",
    "capabilities": { "eventReplay": true }
  }
}
```

订阅一个对话：

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-attach-1",
  "method": "conversation.attach",
  "params": {
    "conversationId": "conv_...",
    "afterSeq": 96
  }
}
```

当 replay buffer 覆盖 `afterSeq` 时，响应为 `mode: "replay"` 并包含 `seq > afterSeq` 的事件；cursor 已过期或大于服务端高水位时，响应为 `mode: "snapshot"` 并返回权威快照。attach 完成后的实时事件使用：

```json
{
  "jsonrpc": "2.0",
  "method": "conversation.event",
  "params": {
    "schemaVersion": 1,
    "conversationId": "conv_...",
    "runId": "run_...",
    "seq": 101,
    "occurredAt": "2026-08-27T10:20:30.123Z",
    "event": { "type": "message.text.delta", "messageId": "msg_...", "contentIndex": 0, "delta": "正在分析" }
  }
}
```

命令 response 只按 JSON-RPC `id` 完成调用 promise；UI 投影只按 Conversation `seq` 排序和去重。不要假定 interrupt response 与 `run.interrupted` 事件的先后顺序。

## 代码结构

```text
src/
  transport/                 Fastify、认证、WebSocket、JSON-RPC、Swagger
  application/               Conversation Manager、Actor、mailbox、Event Hub
  domain/                    状态、事件、Pi event reducer、错误和脱敏
  infrastructure/pi/         严格 JSONL 与 Pi 子进程适配器
test/
  fixtures/                  独立的假 Pi RPC 子进程
  helpers/                   可控 runtime test double
vendor/pi-main/              与运行依赖同版本的 Pi 源码及 MIT 许可证
scripts/vendor-pi.mjs        从独立 Pi checkout 同步 vendor 源码
scripts/verify-pi-vendor.mjs 校验源码版本并 smoke test 包内 RPC entry
```

依赖方向为 `transport -> application -> domain`，Pi 类型不会进入 Domain Contract。

## 测试与验收

详细覆盖范围、验收标准和仍需带真实模型凭证执行的部署前检查见 [docs/test-and-acceptance.md](docs/test-and-acceptance.md)。
