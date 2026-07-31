/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { policiesCommand } from './policiesCommand.js';
import {
  type CommandContext,
  type MessageActionReturn,
  type OpenDialogActionReturn,
} from './types.js';
import { assertDefined } from '../../test-utils/assertions.js';

describe('policiesCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      services: {
        config: null,
      },
    } as unknown as CommandContext;
  });

  it('should have the correct name and description', () => {
    expect(policiesCommand.name).toBe('policies');
    expect(policiesCommand.description).toBe(
      'open the policy manager dialog to inspect and edit rules',
    );
  });

  it('should return an error when neither agent nor config is available', () => {
    assertDefined(policiesCommand.action);

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    });
  });

  it('should return a dialog action when config is available', () => {
    mockContext.services.config = {
      getPolicyEngine: () => ({}),
    } as unknown as CommandContext['services']['config'];

    assertDefined(policiesCommand.action);

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as OpenDialogActionReturn;

    expect(result).toStrictEqual({
      type: 'dialog',
      dialog: 'policies',
    });
  });

  it('should return a dialog action when agent is available', () => {
    mockContext.services.agent = {
      policy: { getRules: () => [] },
    } as unknown as CommandContext['services']['agent'];

    assertDefined(policiesCommand.action);

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as OpenDialogActionReturn;

    expect(result).toStrictEqual({
      type: 'dialog',
      dialog: 'policies',
    });
  });
});
