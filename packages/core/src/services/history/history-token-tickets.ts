/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export interface TokenRowSource {
  read(): Promise<IContent>;
  close(): Promise<void>;
  merge?(source: TokenRowSource): boolean;
  hasNext?(): boolean;
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
  private tail: PendingTokenTicket | undefined;
  private reading: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    private readonly schedule: (execute: () => Promise<void>) => void,
    private readonly process: (ticket: TokenTicket) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}
  assertAdmission(): void {
    if (this.pending.size >= 32)
      throw new Error('Token ticket range admission budget exceeded');
  }
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
    const tail = this.tail;
    if (
      tail !== undefined &&
      tail.modelName === ticket.modelName &&
      tail.generation === ticket.generation &&
      tail.source.merge?.(ticket.source) === true
    ) {
      this.pending.delete(ticket);
      return;
    }
    this.schedule(async () => {
      if (this.tail === ticket) this.tail = undefined;
      if (!this.pending.delete(ticket)) return;
      try {
        if (!this.closed) {
          do {
            const read = ticket.source.read();
            this.reading = read.then(
              () => undefined,
              () => undefined,
            );
            const content = await read;
            await this.process({
              content,
              modelName: ticket.modelName,
              generation: ticket.generation,
            });
          } while (ticket.source.hasNext?.() === true);
        }
      } catch (error) {
        this.failed(error);
      } finally {
        await ticket.source.close();
      }
    });
    this.tail = ticket;
  }
  seal(): void {
    this.tail = undefined;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.tail = undefined;
    const tickets = [...this.pending];
    this.pending.clear();
    await Promise.all([
      this.reading,
      ...tickets.map((ticket) => ticket.source.close()),
    ]);
  }
}
