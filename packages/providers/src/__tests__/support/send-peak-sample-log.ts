/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, writeSync } from 'node:fs';

export interface SendPeakSampleLog {
  write(value: unknown): void;
  close(): void;
}

export function openSendPeakSampleLog(
  path: string | undefined,
): SendPeakSampleLog | undefined {
  if (path === undefined) return undefined;
  const descriptor = openSync(`${path}.samples.jsonl`, 'a');
  return {
    write(value): void {
      writeSync(descriptor, `${JSON.stringify(value)}\n`);
    },
    close(): void {
      closeSync(descriptor);
    },
  };
}
