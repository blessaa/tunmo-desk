<template>
  <section class="chat-pane">
    <header class="chat-head">
      <div>
        <div class="kicker">Agent</div>
        <div class="title">{{ chat.active?.title || '对话' }}</div>
      </div>
      <div class="debug muted">
        调试：窗口内按 Ctrl+Shift+I 看 Console（[pi-rpc]）；主进程日志在运行
        <code>npm run dev</code>
        的终端，以及
        <code>%AppData%\tunmo-desk\logs\main.log</code>
      </div>
    </header>

    <UpdateBanner />

    <div ref="listRef" class="messages scroll">
      <div v-if="!chat.active?.messages.length" class="hero muted">
        向图墨提问。请先选择模型。后端是 tunmo-backend（WebSocket JSON-RPC）。
      </div>

      <article v-for="msg in chat.active?.messages" :key="msg.id" class="msg" :class="msg.role">
        <div class="role">{{ msg.role === 'user' ? '你' : '图墨' }}</div>
        <ToolEventCard v-for="event in msg.toolEvents" :key="event.id" :event="event" />
        <pre class="body">{{ msg.content }}<span v-if="msg.streaming" class="caret">▎</span></pre>
      </article>
    </div>

    <form class="composer" @submit.prevent="onSend">
      <el-input
        v-model="chat.draft"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        resize="none"
        placeholder="先选择模型，再询问图墨… Enter 发送，Shift+Enter 换行"
        @keydown="onComposerKeydown"
      />
      <el-button type="primary" :loading="chat.active?.sending" native-type="submit">发送</el-button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useChatStore } from '@renderer/stores/chat'
import ToolEventCard from './ToolEventCard.vue'
import UpdateBanner from './UpdateBanner.vue'

const chat = useChatStore()
/** 消息列表容器，用来滚到底部。 */
const listRef = ref<HTMLElement | null>(null)

watch(
  () => {
    const messages = chat.active?.messages
    if (!messages) return `${chat.activeId ?? ''}`
    return `${chat.activeId ?? ''}:${messages.map((m) => m.content + m.toolEvents.length + String(m.streaming)).join()}`
  },
  async () => {
    await nextTick()
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  }
)

/** Enter 发送，Shift+Enter 换行。 */
function onComposerKeydown(event: Event): void {
  const keyEvent = event as KeyboardEvent
  if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
    keyEvent.preventDefault()
    onSend()
  }
}

/** 表单提交：把当前输入发给 chat store。 */
function onSend(): void {
  void chat.send()
}
</script>

<style scoped>
.chat-head {
  flex-shrink: 0;
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--tm-border);
}

.kicker {
  font-size: 11px;
  color: var(--tm-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.debug {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.debug code {
  font-size: 11px;
}

.messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22% 12px;
}

.hero {
  margin-top: 18vh;
  text-align: center;
  line-height: 1.7;
}

.msg {
  margin: 0 auto 18px;
  max-width: 820px;
}

.role {
  font-size: 12px;
  color: var(--tm-muted);
  margin-bottom: 6px;
}

.body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.65;
}

.msg.user .body {
  background: var(--tm-user);
  padding: 10px 12px;
  border-radius: 10px;
}

.caret {
  color: var(--tm-accent);
}

.composer {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
  padding: 12px 22% 20px;
}

.composer :deep(.el-textarea__inner) {
  background: var(--tm-input);
  box-shadow: none;
  border: 1px solid var(--tm-border);
  border-radius: 10px;
  color: var(--tm-text);
}
</style>
