/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  exportsIdentifierFromSource,
  exportsModuleFromSource,
} from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'vitest';

describe('export surface helper semantics', () => {
  describe('exportsIdentifierFromSource', () => {
    it('matches the public name, not the local binding, for aliased exports', () => {
      const source =
        "export { LocalTaskTool as PublicTaskTool } from './task.js';";

      expect(exportsIdentifierFromSource(source, 'PublicTaskTool')).toBe(true);
      expect(exportsIdentifierFromSource(source, 'LocalTaskTool')).toBe(false);
    });

    it('honors type-only export filtering for named exports', () => {
      const source = "export type { TaskToolParams } from './task.js';";

      expect(exportsIdentifierFromSource(source, 'TaskToolParams')).toBe(false);
      expect(
        exportsIdentifierFromSource(source, 'TaskToolParams', {
          includeTypeOnly: true,
        }),
      ).toBe(true);
    });
  });

  describe('exportsModuleFromSource', () => {
    it('treats namespace re-exports as module re-exports', () => {
      const source = "export * as taskTools from './tools/task.js';";

      expect(exportsModuleFromSource(source, './tools/task.js')).toBe(true);
    });

    it('honors type-only export filtering for module re-exports', () => {
      const source = "export type * from './tools/task.js';";

      expect(exportsModuleFromSource(source, './tools/task.js')).toBe(false);
      expect(
        exportsModuleFromSource(source, './tools/task.js', {
          includeTypeOnly: true,
        }),
      ).toBe(true);
    });
  });
});
