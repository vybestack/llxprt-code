/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P30
 * @plan PLAN-20260214-SESSIONBROWSER.P31
 * @requirement REQ-SW-001, REQ-SW-002, REQ-SW-003, REQ-SW-006, REQ-SW-007
 * @requirement REQ-EN-001, REQ-EN-002, REQ-EN-004
 * @requirement REQ-EH-001, REQ-EH-004
 * @requirement REQ-CV-001, REQ-CV-002
 * @requirement REQ-PR-001, REQ-PR-003
 * Continue command integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { continueCommand } from '../ui/commands/continueCommand.js';
import type {
  CommandContext,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import {
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  makeCommandContext,
  makeMockLogger,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Continue command integration #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 14: continueCommand in non-interactive mode with no args returns error
   * @requirement REQ-PR-003
   */

  /**
   * Test 14: continueCommand in non-interactive mode with no args returns error
   * @requirement REQ-PR-003
   */
  it('continueCommand in non-interactive mode returns error @requirement:REQ-PR-003', async () => {
    const ctx = makeCommandContext({
      services: {
        config: {
          isInteractive: () => false,
        } as CommandContext['services']['config'],
        settings: {} as CommandContext['services']['settings'],
        git: undefined,
        logger: makeMockLogger(),
      },
    });

    const result = (await continueCommand.action!(
      ctx,
      '',
    )) as SlashCommandActionReturn;

    expect(result).toBeDefined();
    expect(result.type).toBe('message');
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (result.type === 'message') {
      // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
      expect(result.messageType).toBe('error');
      // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
      expect(result.content).toContain('interactive');
    }
  });
});
