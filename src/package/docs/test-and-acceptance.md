# 测试策略与验收记录

## 自动化命令

```bash
pnpm check
pnpm test
pnpm build
```

测试不读取真实 provider key，不发起付费模型调用，也不写入 `pi-main`。Pi 进程协议通过独立的 JSONL fixture 子进程进行 contract test。

## 已自动化覆盖

### 严格 JSONL 与 Pi adapter

- 半包、粘包、CRLF 输入；
- UTF-8 多字节字符跨 chunk；
- `U+2028/U+2029` 保留在 JSON 字符串内，不作为分隔符；
- 流结束时最后一条无 LF 记录；
- command id 与 response 关联；
- 重复 response 和未知 response 被隔离；
- Pi 事件与 command response 分离；
- Pi 子进程异常退出时 active run 明确进入 failed。

### Conversation Actor 与 reducer

- prompt 预检前到达的 Pi 事件先暂存，`run.accepted` 保持为首个 Run 事件；
- `text_start/delta/end` 按 `contentIndex` 组装；
- `message_end.message` 覆盖临时组装结果；
- 并行 `toolCallId` 独立 start/update/end，progress 使用累计替换语义；
- tool 输入中的 token/password/secret 等字段脱敏；
- retry 和 compaction 不提前结束；
- `agent_end.willRetry=true` 不产生 settled；
- `agent_settled` 才结算当前 Run；
- Conversation 内 `seq` 连续、单调递增；
- `clientRequestId` 重试只执行一次 Pi prompt；
- 中断命令幂等；
- 对旧 Run 的晚到中断不会影响新 Run；
- abort 超时强制停止 runtime，并在下一次 send 重建；
- replay cursor 在缓存内时只返回 `seq > afterSeq` 的事件。

### Fastify、WebSocket 与 Swagger

- HTTP JSON-RPC 与 WebSocket 复用同一 dispatcher；
- prompt preflight 拒绝时返回错误，不返回 accepted；
- WebSocket `initialize -> create -> attach -> send -> notification -> settled` 完整闭环；
- socket close 不调用 abort；
- Run 在断线期间继续，重连后 replay 无 seq 空洞；
- 慢连接收到 `resync.required` 并以 1013 关闭；
- OpenAPI 文档包含中文标题、字段说明、请求模型和响应模型；
- TypeScript strict check、测试和生产 build 全部通过。

## 第一版前后端验收标准映射

1. `conversation.send` 在 Pi prompt 预检成功后返回唯一 `runId`：已自动化。
2. 文本流式显示并由 `message.completed` 校正：后端事件与校正已自动化；前端渲染需联调。
3. 并行工具分别显示状态和结果：后端按 `toolCallId` 投影已自动化；前端展示需联调。
4. `agent_end.willRetry=true` 不误显示完成：后端已自动化；前端必须只消费 `run.settled`。
5. 仅 `agent_settled` 后恢复 idle：后端已自动化；前端输入区行为需联调。
6. 点击停止后立即显示 interrupting，并最终 interrupted 或 timeout：两条后端路径已自动化；UI 文案需联调。
7. 重复点击停止不影响下一轮：已自动化。
8. 刷新后恢复消息、active run 和工具：snapshot/replay 已自动化；浏览器持久化最后 `seq` 需联调。
9. 重复或乱序事件不重复渲染：后端保证唯一递增 `seq`；前端必须按 `seq` 去重并拒绝倒退。
10. 从 RPC 追踪到 Pi command、tool call 和结算：结构化字段已实现；日志采集平台查询需在部署环境验收。

## 部署前必须补做的真实环境验收

以下检查依赖实际 Pi 构建、模型凭证、真实工具和前端，不应由无凭证的单元测试伪造为已通过：

1. 使用目标 Pi release/fork 启动服务并完成一次真实模型回答；
2. 执行至少一个可流式输出的工具，核对累计 progress 和最终结果；
3. 在模型生成期间 abort，核对 Pi 返回 idle 和 `agent_settled`；
4. 在长时工具期间 abort，确认该工具确实消费 Pi 传入的 `AbortSignal` 并清理其子进程或网络请求；
5. 构造忽略 abort 的测试工具，确认超时后只终止目标 Conversation 的 Pi 子进程；
6. 网络断开后等待 Run 继续，再重连并核对快照、replay 和 UI 无重复；
7. 使用真实慢客户端或代理施加背压，确认 Pi stdout 消费不被阻塞；
8. 检索一次执行的结构化日志，核对 RPC、Run、Pi command、tool call 与最终结算字段；
9. 若多实例部署，确认负载均衡按 `conversationId` 粘性路由；
10. 生产环境确认 `AUTH_TOKEN`、`ALLOWED_ORIGINS`、cwd allowlist、会话目录权限和 secret 注入均已配置。

真实工具是否响应 `AbortSignal` 是 Pi 工具实现本身的责任。本项目提供协作式 abort、超时和单会话进程强制终止边界，但不会宣称无法安全中断的外部副作用已经回滚。
