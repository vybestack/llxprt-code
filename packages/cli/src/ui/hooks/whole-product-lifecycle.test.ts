/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { wholeProductFixture } from '../../__tests__/support/whole-product-fixture.js';
import {
  sendAndCheckpoint,
  forkAndSwitch,
  compressAndPackage,
  reopen,
} from '../../__tests__/support/whole-product-lifecycle.js';
import { verifyReleased } from '../../__tests__/support/whole-product-observer.js';

describe('whole-product native lifecycle', () => {
  it('keeps sends, tools, CLI forks, live resume, compression, packages and cold reopen durable together', async () => {
    const fixture = await wholeProductFixture();
    try {
      const checkpoint = await sendAndCheckpoint(fixture);
      const branch = await forkAndSwitch(fixture, checkpoint);
      const imported = await compressAndPackage(fixture, branch);
      await reopen(fixture, imported);
      await verifyReleased([branch.source, branch.fork, imported.path]);
      expect(new Set([branch.source, branch.fork, imported.path]).size).toBe(3);
    } finally {
      await fixture.close();
    }
  }, 30000);
});
