/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, afterEach, beforeAll } from 'bun:test';
import {
  HISTORY_BACKEND_ENV,
  type HistoryBackend,
} from '../../../services/history/historyBackendSelect.js';

/** Returns a setter for the history backend that the test's `afterEach` restores. */
export function useBackendEnv(): (backend: HistoryBackend) => void {
  const saved = process.env[HISTORY_BACKEND_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
  });
  return (backend) => {
    process.env[HISTORY_BACKEND_ENV] = backend;
  };
}

/**
 * Pins the history backend for every test of the calling file and restores it
 * afterwards. For files whose fixtures are recordings of one backend's layout:
 * session discovery follows the environment, so they must not follow it.
 */
export function pinHistoryBackend(backend: HistoryBackend): void {
  const saved = process.env[HISTORY_BACKEND_ENV];
  beforeAll(() => {
    process.env[HISTORY_BACKEND_ENV] = backend;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
  });
}
