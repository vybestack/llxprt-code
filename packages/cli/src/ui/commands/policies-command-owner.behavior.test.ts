/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createPoliciesCommand } from './policiesCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';

describe('registered policies command owner', () => {
  it('renders the policy snapshot supplied by its owner', () => {
    const command = createPoliciesCommand({
      getPolicyInfo: () => ({
        rules: [
          {
            priority: 1,
            toolName: 'registered-tool',
            decision: PolicyDecision.ALLOW,
          },
        ],
        defaultDecision: PolicyDecision.DENY,
        nonInteractive: false,
      }),
    });
    const invocation = createMockCommandContext();

    const result = command.action?.(invocation, 'list');

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('registered-tool'),
    });
  });
});
