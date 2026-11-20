/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Config } from './config.js';
import { ScratchRootOwner } from '../storage/scratch-root.js';

function runtimeConfig(
  sessionId: string,
  scratchRoots: ScratchRootOwner,
): Config {
  return new Config({
    scratchRoots,
    sessionId,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'test-model',
    provider: 'test-provider',
    debugMode: false,
  });
}

describe('startup scratch domain inheritance', () => {
  it('keeps multiple runtime configurations inside the supplied startup root', () => {
    const startup = new ScratchRootOwner();
    try {
      const foreground = runtimeConfig('foreground', startup);
      const child = runtimeConfig('child', foreground.scratchRoots);
      const first = foreground.scratchRoots.createDirSync('foreground-');
      const second = child.scratchRoots.createDirSync('child-');
      expect(dirname(first)).toBe(dirname(second));
      startup.removeRoot();
      expect(existsSync(first)).toBe(false);
      expect(existsSync(second)).toBe(false);
    } finally {
      startup.removeRoot();
    }
  });
});
