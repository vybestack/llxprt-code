/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { describe, it, expect, beforeEach } from 'bun:test';
import { themeCommand } from './themeCommand.js';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { assertDefined } from '../../__tests__/assertions.js';

describe('themeCommand', () => {
  let mockContext: CommandOwnerFixture;

  beforeEach(() => {
    mockContext = createMockCommandContext();
  });

  it('should return a dialog action to open the theme dialog', () => {
    // Ensure the command has an action to test.
    assertDefined(themeCommand.action);

    const result = themeCommand.action(mockContext, '');

    // Assert that the action returns the correct object to trigger the theme dialog.
    expect(result).toStrictEqual({
      type: 'dialog',
      dialog: 'theme',
    });
  });

  it('should have the correct name and description', () => {
    expect(themeCommand.name).toBe('theme');
    expect(themeCommand.description).toBe('change the theme');
  });
});
