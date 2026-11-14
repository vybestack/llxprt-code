/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** The two operations the Responses source input needs from a segment writer. */
export interface PromptKeySink {
  append(text: string): void;
  value(value: unknown): void;
}

/**
 * Feeds one pass over the journal rows to the estimator-form writer and the
 * wire-form writer, so rows are scanned once.
 */
export class PromptKeyTeeWriter implements PromptKeySink {
  constructor(private readonly sinks: readonly PromptKeySink[]) {}

  append(text: string): void {
    for (const sink of this.sinks) sink.append(text);
  }

  value(value: unknown): void {
    for (const sink of this.sinks) sink.value(value);
  }
}
