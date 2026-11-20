/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ScratchRootOwner } from '../../scratch-root.js';

export function createTestScratchOwner(): ScratchRootOwner {
  // Child probes use the owner's exit hook; bun test uses the scratch preload.
  return new ScratchRootOwner();
}
