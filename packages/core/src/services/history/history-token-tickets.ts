/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SynchronousValueSpool } from '../../recording/synchronous-value-spool.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { isRecord, isSpeakerContent } from './historyJournalGuards.js';
import type { IContent } from './IContent.js';

interface TokenTicket {
  readonly content: IContent;
  readonly modelName?: string;
  readonly generation: number;
}
interface TokenSpan {
  next: number;
  end: number;
  sealed: boolean;
}

function decodeTokenTicket(value: unknown): TokenTicket {
  if (!isRecord(value)) throw new Error('Invalid token value ticket');
  if (
    !isSpeakerContent(value.content) ||
    typeof value.generation !== 'number' ||
    (value.modelName !== undefined && typeof value.modelName !== 'string')
  )
    throw new Error('Invalid token value ticket');
  return {
    content: value.content,
    generation: value.generation,
    modelName: value.modelName,
  };
}

export class HistoryTokenTickets {
  private values = new SynchronousValueSpool(decodeTokenTicket);
  private span: TokenSpan | undefined;
  private closed = false;
  constructor(
    private readonly schedule: (execute: () => Promise<void>) => void,
    private readonly process: (ticket: TokenTicket) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}
  prepare(
    content: IContent,
    modelName: string | undefined,
    generation: number,
  ): number {
    return this.values.append({
      content: sanitizeProviderContentForSerialization(content),
      modelName,
      generation,
    });
  }
  cancel(ordinal: number): void {
    this.values.truncate(ordinal);
  }
  publish(ordinal: number): void {
    if (this.span !== undefined && !this.span.sealed) {
      this.span.end = ordinal + 1;
      return;
    }
    const span: TokenSpan = { next: ordinal, end: ordinal + 1, sealed: false };
    this.span = span;
    this.schedule(() => this.drain(span));
  }
  seal(): void {
    if (this.span !== undefined) this.span.sealed = true;
    this.span = undefined;
  }
  private async drain(span: TokenSpan): Promise<void> {
    while (!this.closed && span.next < span.end) {
      try {
        await this.process(this.values.read(span.next++));
      } catch (error) {
        this.failed(error);
      }
    }
    if (this.span === span) this.seal();
    if (!this.closed && span.next === this.values.length) {
      this.values.close();
      this.values = new SynchronousValueSpool(decodeTokenTicket);
    }
  }
  close(): void {
    this.closed = true;
    this.seal();
    this.values.close();
  }
}
