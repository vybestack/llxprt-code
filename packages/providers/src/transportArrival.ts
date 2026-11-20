/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { markErrorAfterStreamOutput } from './retryErrorClassification.js';

export class TransportRecordingError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'TransportRecordingError';
  }
}
export async function recordTransportAttempt(
  options: {
    readonly onTransportAttempt?: (boundary?: 'wrapper') => Promise<void>;
  },
  boundary?: 'wrapper',
): Promise<void> {
  try {
    await options.onTransportAttempt?.(boundary);
  } catch (error) {
    throw markErrorAfterStreamOutput(new TransportRecordingError(error));
  }
}
export function recordingOnly(content: IContent): boolean {
  return (
    content.toolArgumentDelta !== undefined &&
    content.blocks.length === 0 &&
    content.metadata === undefined
  );
}
