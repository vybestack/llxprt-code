/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export interface TokenRowSource {
  read(): Promise<IContent>;
  close(): Promise<void>;
}
interface TokenTicket {
  readonly content: IContent;
  readonly modelName?: string;
  readonly generation: number;
}
interface PendingTokenTicket {
  readonly source: TokenRowSource;
  readonly modelName: string | undefined;
  readonly generation: number;
}

export class HistoryTokenTickets {
  private readonly pending = new Set<PendingTokenTicket>();
  private closed = false;
  constructor(
    private readonly schedule: (execute: () => Promise<void>) => void,
    private readonly process: (ticket: TokenTicket) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}
  prepare(
    source: TokenRowSource,
    modelName: string | undefined,
    generation: number,
  ): PendingTokenTicket {
    const ticket = { source, modelName, generation };
    this.pending.add(ticket);
    return ticket;
  }
  cancel(ticket: PendingTokenTicket): void {
    this.pending.delete(ticket);
    void ticket.source.close().catch(this.failed);
  }
  publish(ticket: PendingTokenTicket): void {
    this.schedule(async () => {
      if (!this.pending.delete(ticket)) return;
      try {
        if (!this.closed) {
          const content = await ticket.source.read();
          await ticket.source.close();
          await this.process({
            content,
            modelName: ticket.modelName,
            generation: ticket.generation,
          });
        }
      } catch (error) {
        this.failed(error);
      } finally {
        await ticket.source.close();
      }
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    const tickets = [...this.pending];
    this.pending.clear();
    await Promise.all(tickets.map((ticket) => ticket.source.close()));
  }
}
