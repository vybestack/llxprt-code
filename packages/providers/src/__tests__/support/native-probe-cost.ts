/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fileBytes(directory: string): number {
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? fileBytes(path) : statSync(path).size;
  }
  return bytes;
}

export function nativeProbeCost(directory: string): () => {
  elapsedMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  journalBytesAdded: number;
  kernelReadOperations: number;
  kernelWriteOperations: number;
} {
  const before = fileBytes(join(directory, 'journal'));
  const cpu = process.cpuUsage();
  const usage = process.resourceUsage();
  const start = performance.now();
  return () => {
    const after = process.resourceUsage();
    const consumed = process.cpuUsage(cpu);
    return {
      elapsedMs: performance.now() - start,
      cpuUserMicros: consumed.user,
      cpuSystemMicros: consumed.system,
      journalBytesAdded: fileBytes(join(directory, 'journal')) - before,
      kernelReadOperations: after.fsRead - usage.fsRead,
      kernelWriteOperations: after.fsWrite - usage.fsWrite,
    };
  };
}
