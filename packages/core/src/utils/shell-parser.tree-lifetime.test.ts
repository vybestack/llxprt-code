/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */

import { afterAll, describe, expect, it } from 'bun:test';
import type { Tree } from 'web-tree-sitter';
import { initializeParser, resetParser } from './shell-parser.js';
import { withParsedTree } from './shell-parser-lifetime.js';

const parserInitialized = await initializeParser();

/**
 * web-tree-sitter exposes the wasm-side pointer as the numeric property
 * "0" on the Tree proxy. While the tree is alive the value is a nonzero
 * heap pointer; tree.delete() zeroes it. Asserting alive-then-zero (rather
 * than zero alone) proves the deletion actually ran — a tree that was
 * never deleted keeps its live pointer.
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
function treeHandle(tree: Tree): number {
  const handle: unknown = Reflect.get(tree, 0);
  if (typeof handle !== 'number') {
    throw new Error('Tree handle is not numeric');
  }
  return handle;
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-08 */
describe('withParsedTree tree lifetime', () => {
  afterAll(() => {
    resetParser();
  });

  describe.skipIf(!parserInitialized)(() => {
    /** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-08 */
    it('deletes the tree after the consumer returns', () => {
      const captured: Tree[] = [];
      let liveHandle = -1;

      const result = withParsedTree('echo hi', (tree) => {
        captured.push(tree);
        liveHandle = treeHandle(tree);
        return tree.rootNode.text;
      });

      expect(result).toBe('echo hi');
      expect(captured).toHaveLength(1);
      expect(liveHandle).toBeGreaterThan(0);
      expect(treeHandle(captured[0])).toBe(0);
    });

    /** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-08 */
    it('deletes the tree and propagates an error when the consumer throws', () => {
      const captured: Tree[] = [];
      let liveHandle = -1;

      expect(() =>
        withParsedTree('echo hi', (tree) => {
          captured.push(tree);
          liveHandle = treeHandle(tree);
          throw new Error('consumer failed');
        }),
      ).toThrow('consumer failed');
      expect(captured).toHaveLength(1);
      expect(liveHandle).toBeGreaterThan(0);
      expect(treeHandle(captured[0])).toBe(0);
    });
  });
});
