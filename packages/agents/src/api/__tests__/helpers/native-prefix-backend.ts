/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';

export function useNativePrefixBackend(): void {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.LLXPRT_HISTORY_BACKEND;
    process.env.LLXPRT_HISTORY_BACKEND = 'journal';
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.LLXPRT_HISTORY_BACKEND;
    else process.env.LLXPRT_HISTORY_BACKEND = previous;
  });
}
