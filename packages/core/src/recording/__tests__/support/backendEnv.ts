/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
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
