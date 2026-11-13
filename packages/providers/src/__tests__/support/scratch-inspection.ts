/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, spyOn } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

/** Observe roots actually used by scratch-free APIs that expose no owner. */
export function registerScratchInspection(): () => string[] {
  const roots = new Set<string>();
  const getRoot = ScratchRootOwner.prototype.getRoot;
  let restore = (): void => {};
  beforeEach(() => {
    roots.clear();
    const probe = spyOn(
      ScratchRootOwner.prototype,
      'getRoot',
    ).mockImplementation(function (this: ScratchRootOwner): string {
      const root = getRoot.call(this);
      roots.add(root);
      return root;
    });
    restore = () => probe.mockRestore();
  });
  afterEach(() => restore());
  return () =>
    [...roots]
      .filter((root) => existsSync(root))
      .flatMap((root) => readdirSync(root))
      .sort();
}
