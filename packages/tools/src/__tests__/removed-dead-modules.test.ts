/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guard test codifying the removal of dead tools modules.
 *
 * Issue #3293; inventory: project-plans/issue2232-dead-code-inventory.md.
 * The empty stub file has no consumers. The private barrels duplicate the
 * root entrypoint's direct leaf-module exports, and the structural replacement
 * types are unreferenced. Module absence also guards erased type-only exports.
 *
 * @plan:PLAN-20260914-ISSUE3293.P1
 * @requirement:REQ-3293-01
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'bun:test';

const localRequire = createRequire(import.meta.url);

describe('Removed dead tools modules', () => {
  /** @plan:PLAN-20260914-ISSUE3293.P1 @requirement:REQ-3293-01 */
  it.each([
    '../tools/stubs.js',
    '../formatters/index.js',
    '../types/index.js',
    '../types/provider-content-types.js',
  ])('does not ship %s', (modulePath) => {
    expect(() => localRequire.resolve(modulePath)).toThrow(
      /Cannot find module|Failed to (?:resolve|load)/i,
    );
  });
});

describe('Live leaf modules remain available', () => {
  /** @plan:PLAN-20260914-ISSUE3293.P1 @requirement:REQ-3293-01 */
  it.each([
    '../formatters/IToolFormatter.js',
    '../formatters/ToolFormatter.js',
    '../types/tool-names.js',
    '../types/tool-context.js',
  ])('still resolves %s', (modulePath) => {
    expect(() => localRequire.resolve(modulePath)).not.toThrow();
  });
});
