/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P09
 * @requirement:REQ-006
 * @pseudocode ArgumentSchema.md lines 111-130
 * - Line 71-90: createCompletionHandler integration within useSlashCompletion
 * - Line 111-130: `/set` schema mapping requirements (literal tree + hints)
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P09a
 * Verification (2025-10-16):
 * - Command: `cd packages/cli && npx vitest run src/ui/hooks/__tests__/useSlashCompletion.set.phase09.test.ts`
 * - Result: 3 passed (schema exposed for useSlashCompletion)
 */

import { describe, it, expect } from 'vitest';
import { setCommand } from '../../commands/setCommand.js';

describe('`/set` schema contract for useSlashCompletion @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', () => {
  it('exposes a schema definition (RED until migration)', () => {
    expect(setCommand.schema).toBeDefined();
    expect(Array.isArray(setCommand.schema)).toBe(true);
  });

  it('declares literal subcommand nodes for unset/modelparam/emojifilter (RED)', () => {
    const literalValues =
      setCommand.schema
        ?.filter((node) => node.kind === 'literal')
        ?.map((node) => node.value) ?? [];

    expect(literalValues).toEqual(
      expect.arrayContaining(['unset', 'modelparam', 'emojifilter']),
    );
  });

  it('provides nested hints for `/set modelparam` flow (RED)', () => {
    const modelParamNode = setCommand.schema
      ?.filter((node) => node.kind === 'literal')
      ?.find((node) => node.value === 'modelparam');

    const valueNode = modelParamNode?.next?.find(
      (child) => child.kind === 'value',
    );

    expect(valueNode?.hint).toBe('parameter name');
  });
});
