/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll } from 'bun:test';

const ENV = 'LLXPRT_HISTORY_BACKEND';

/**
 * Pins the history backend for every test of the calling file and restores it
 * afterwards. For tests whose fixtures are recordings of one backend's layout:
 * session discovery follows the environment, so they must not follow it.
 */
export function pinHistoryBackend(backend: 'old' | 'journal'): void {
  const saved = process.env[ENV];
  beforeAll(() => {
    process.env[ENV] = backend;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });
}
