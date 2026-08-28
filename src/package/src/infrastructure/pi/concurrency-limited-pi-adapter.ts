import type { ImageInput } from "../../domain/types.js";
import { DomainError } from "../../domain/errors.js";
import type {
  PiRuntimeAdapter,
  PiRuntimeEvent,
  PiRuntimeFactory,
  PiRuntimeStatus,
  PiSessionState,
} from "./pi-runtime.js";

class AsyncSemaphore {
  private available: number;
  private readonly waiters: Array<(release: () => void) => void> = [];

  constructor(capacity: number) {
    this.available = capacity;
  }

  acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (waiter) waiter(this.createRelease());
      else this.available += 1;
    };
  }
}

class ConcurrencyLimitedPiAdapter implements PiRuntimeAdapter {
  private readonly inner: PiRuntimeAdapter;
  private readonly semaphore: AsyncSemaphore;
  private releaseSlot: (() => void) | undefined;
  private cancelled = false;

  constructor(inner: PiRuntimeAdapter, semaphore: AsyncSemaphore) {
    this.inner = inner;
    this.semaphore = semaphore;
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  get status(): PiRuntimeStatus {
    return this.inner.status;
  }

  async start(): Promise<void> {
    const release = await this.semaphore.acquire();
    if (this.cancelled) {
      release();
      throw new DomainError("PI_UNAVAILABLE", { retryable: true });
    }
    this.releaseSlot = release;
    try {
      await this.inner.start();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  prompt(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    return this.inner.prompt(input);
  }

  steer(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    return this.inner.steer(input);
  }

  followUp(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    return this.inner.followUp(input);
  }

  abort(input: { commandId: string; timeoutMs: number }): Promise<void> {
    return this.inner.abort(input);
  }

  getState(): Promise<PiSessionState> {
    return this.inner.getState();
  }

  onEvent(listener: (event: PiRuntimeEvent) => void): () => void {
    return this.inner.onEvent((event) => {
      if (event.type === "__runtime_exit") this.release();
      listener(event);
    });
  }

  async stop(reason: string, force?: boolean): Promise<void> {
    this.cancelled = true;
    try {
      await this.inner.stop(reason, force);
    } finally {
      this.release();
    }
  }

  private release(): void {
    this.releaseSlot?.();
    this.releaseSlot = undefined;
  }
}

export function withPiConcurrencyLimit(factory: PiRuntimeFactory, capacity: number): PiRuntimeFactory {
  const semaphore = new AsyncSemaphore(capacity);
  return (options) => new ConcurrencyLimitedPiAdapter(factory(options), semaphore);
}
