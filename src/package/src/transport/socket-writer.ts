import type WebSocket from "ws";

export class SocketWriter {
  private readonly socket: WebSocket;
  private readonly maxBufferedBytes: number;
  private resyncSent = false;

  constructor(socket: WebSocket, maxBufferedBytes: number) {
    this.socket = socket;
    this.maxBufferedBytes = maxBufferedBytes;
  }

  send(value: unknown): boolean {
    if (this.socket.readyState !== this.socket.OPEN) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }

  notify(method: string, params: unknown): boolean {
    if (this.socket.bufferedAmount <= this.maxBufferedBytes) {
      return this.send({ jsonrpc: "2.0", method, params });
    }

    if (!this.resyncSent) {
      this.resyncSent = true;
      this.send({
        jsonrpc: "2.0",
        method: "resync.required",
        params: {
          reason: "slow_client",
          message: "客户端消费速度过慢，请重新获取快照并按 seq 恢复。",
        },
      });
    }
    this.socket.close(1013, "resync required");
    return false;
  }
}
