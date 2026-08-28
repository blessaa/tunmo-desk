import type { ConversationEventEnvelope } from "../domain/types.js";

export type EventListener = (event: ConversationEventEnvelope) => void;

export class EventHub {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ConversationEventEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个连接写入失败不能影响 Conversation Actor 状态提交。
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
