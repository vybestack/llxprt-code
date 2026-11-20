/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll } from 'bun:test';
import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

export function createTestScratchOwner(): ScratchRootOwner {
  const owner = new ScratchRootOwner();
  afterAll(() => owner.removeRoot());
  return owner;
}
