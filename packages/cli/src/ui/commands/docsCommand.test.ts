/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreEnv } from '@vybestack/llxprt-code-test-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createDocsCommand } from './docsCommand.js';
import { type CommandContext, type SlashCommand } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { assertDefined } from '../../test-utils/assertions.js';

const docsUrl =
  'https://github.com/vybestack/llxprt-code/blob/main/docs/index.md';

describe('docsCommand', () => {
  let mockContext: CommandContext;
  let command: SlashCommand;
  let browserLaunchDisabled: boolean;
  const mockOpen = vi.fn(async (_url: string): Promise<void> => {});

  beforeEach(() => {
    mockContext = createMockCommandContext();
    mockOpen.mockClear();
    browserLaunchDisabled = false;
    command = createDocsCommand({
      openUrl: mockOpen,
      isBrowserLaunchDisabledDuringTests: () => browserLaunchDisabled,
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it("should add an info message and call 'open' in a non-sandbox environment", async () => {
    assertDefined(command.action);

    await command.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: `Opening documentation in your browser: ${docsUrl}`,
      },
      expect.any(Number),
    );
    expect(mockOpen).toHaveBeenCalledWith(docsUrl);
  });

  it('should only add an info message in a sandbox environment', async () => {
    assertDefined(command.action);
    process.env.SANDBOX = 'gemini-sandbox';

    await command.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: `Please open the following URL in your browser to view the documentation:\n${docsUrl}`,
      },
      expect.any(Number),
    );
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("should open the browser for 'sandbox-exec'", async () => {
    assertDefined(command.action);
    process.env.SANDBOX = 'sandbox-exec';

    await command.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: `Opening documentation in your browser: ${docsUrl}`,
      },
      expect.any(Number),
    );
    expect(mockOpen).toHaveBeenCalledWith(docsUrl);
  });

  it('does not launch a browser when test policy fails closed', async () => {
    assertDefined(command.action);
    browserLaunchDisabled = true;

    await command.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: `Please open the following URL in your browser to view the documentation:\n${docsUrl}`,
      },
      expect.any(Number),
    );
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
