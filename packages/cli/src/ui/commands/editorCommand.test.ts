/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { editorCommand } from './editorCommand.js';
// 1. Import the mock context utility
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { assertDefined } from '../../test-utils/assertions.js';

describe('editorCommand', () => {
  it('should return a dialog action to open the editor dialog', () => {
    assertDefined(editorCommand.action);
    const mockContext = createMockCommandContext();
    const result = editorCommand.action(mockContext, '');

    expect(result).toStrictEqual({
      type: 'dialog',
      dialog: 'editor',
    });
  });

  it('should have the correct name and description', () => {
    expect(editorCommand.name).toBe('editor');
    expect(editorCommand.description).toBe('set external editor preference');
  });
});
