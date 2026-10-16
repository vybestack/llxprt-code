/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Registers a fresh temporary directory for each test of the enclosing
 * describe block and removes it afterwards. Returns an accessor that is valid
 * while a test runs.
 */
export function useTempDir(prefix: string): () => string {
  let directory: string | undefined;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  });
  afterEach(async () => {
    if (directory !== undefined) {
      await fs.rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });
  return () => {
    if (directory === undefined) {
      throw new Error('useTempDir accessor used outside a running test');
    }
    return directory;
  };
}
