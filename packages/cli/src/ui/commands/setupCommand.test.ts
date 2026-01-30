/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { setupCommand } from './setupCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

// Mock the welcome config module
vi.mock('../../config/welcomeConfig.js', () => ({
  saveWelcomeConfig: vi.fn(),
  resetWelcomeConfigForTesting: vi.fn(),
}));

import { saveWelcomeConfig } from '../../config/welcomeConfig.js';

describe('setupCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockCommandContext();
  });

  it('should have correct metadata', () => {
    expect(setupCommand.name).toBe('setup');
    expect(setupCommand.description).toBe(
      're-run the welcome onboarding flow to configure provider and model',
    );
  });

  it('should reset welcome config and return dialog action', async () => {
    if (!setupCommand.action) {
      throw new Error('setupCommand must have an action.');
    }

    const result = await setupCommand.action(mockContext, '');

    // Verify saveWelcomeConfig was called with welcomeCompleted: false
    expect(saveWelcomeConfig).toHaveBeenCalledWith({
      welcomeCompleted: false,
    });

    // Verify it returns a dialog action for 'welcome'
    expect(result).toEqual({
      type: 'dialog',
      dialog: 'welcome',
    });
  });
});
