/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeNativeFileCreates } from './support/native-file-observer.js';
import { openSendPeakSampleLog } from './support/send-peak-sample-log.js';

describe('send peak sample diagnostics', () => {
  it('records samples through a preopened file without creating measured request files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'send-peak-log-'));
    const path = join(directory, 'measurements');
    const log = openSendPeakSampleLog(path);
    if (log === undefined) throw new Error('Missing sample log');
    const observer = observeNativeFileCreates();
    try {
      log.write({ phase: 'http', heapDelta: 123 });
      log.write({ phase: 'rows', heapDelta: 456 });
      expect(observer.count()).toBe(0);
      expect(readFileSync(`${path}.samples.jsonl`, 'utf8')).toBe(
        '{"phase":"http","heapDelta":123}\n{"phase":"rows","heapDelta":456}\n',
      );
      writeFileSync(join(directory, 'request-created-inside-send'), 'trap');
      expect(observer.count()).toBeGreaterThan(0);
    } finally {
      observer.restore();
      log.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not open a diagnostic log when logging is absent', () => {
    const observer = observeNativeFileCreates();
    try {
      expect(openSendPeakSampleLog(undefined)).toBeUndefined();
      expect(observer.count()).toBe(0);
    } finally {
      observer.restore();
    }
  });
});
