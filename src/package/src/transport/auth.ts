import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../domain/errors.js";

interface TicketRecord {
  ownerId: string;
  expiresAt: number;
}

export class WebSocketTicketStore {
  private readonly ttlMs: number;
  private readonly tickets = new Map<string, TicketRecord>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  issue(ownerId: string): { ticket: string; expiresAt: string } {
    this.purge();
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.tickets.set(ticket, { ownerId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(ticket: string): string | undefined {
    const record = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!record || record.expiresAt < Date.now()) return undefined;
    return record.ownerId;
  }

  private purge(): void {
    const now = Date.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}

export interface AuthOptions {
  token?: string;
  ownerId: string;
}

export function authenticateHttp(request: FastifyRequest, options: AuthOptions): string {
  if (!options.token) return "development-user";
  const header = request.headers.authorization;
  if (header !== `Bearer ${options.token}`) throw new DomainError("UNAUTHORIZED");
  return options.ownerId;
}

export function authenticateWebSocket(
  request: FastifyRequest,
  options: AuthOptions,
  tickets: WebSocketTicketStore,
): string {
  if (!options.token) return "development-user";
  const header = request.headers.authorization;
  if (header === `Bearer ${options.token}`) return options.ownerId;
  const query = request.query;
  if (typeof query === "object" && query !== null && "ticket" in query && typeof query.ticket === "string") {
    const ownerId = tickets.consume(query.ticket);
    if (ownerId) return ownerId;
  }
  throw new DomainError("UNAUTHORIZED");
}
