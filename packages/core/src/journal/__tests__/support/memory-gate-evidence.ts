/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';

export function recordMemoryGate(
  gate: string,
  values: Readonly<Record<string, number>>,
): void {
  const path = process.env.MEMORY_GATE_LOG;
  if (path !== undefined) {
    appendFileSync(path, `${JSON.stringify({ gate, ...values })}\n`);
  }
}
