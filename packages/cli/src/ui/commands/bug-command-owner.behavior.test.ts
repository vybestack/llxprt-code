/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createBugCommand } from './bugCommand.js';

describe('registered bug command owner', () => {
  it('uses the registered configuration when building its report URL', async () => {
    const history: Array<{ text: string }> = [];
    const command = createBugCommand(
      {
        getModel: () => 'registered-model',
        getReportUrlTemplate: () =>
          'https://reports.invalid/?title={title}&info={info}',
        getIdeDisplayName: () => '',
        getConversationHistory: () => undefined,
        addItem: (item) => history.push({ text: item.text ?? '' }),
      },
      {
        openUrl: async () => {},
        isBrowserLaunchDisabledDuringTests: () => true,
      },
    );
    const invocation = createMockCommandContext({
      services: {
        config: {
          getModel: () => 'invocation-model',
          getBugCommand: () => undefined,
        },
      },
    });

    await command.action?.(invocation, 'test bug');

    expect(history).toHaveLength(1);
    expect(decodeURIComponent(history[0].text)).toContain('registered-model');
    expect(decodeURIComponent(history[0].text)).not.toContain(
      'invocation-model',
    );
  });
});
