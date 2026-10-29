/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLaunchDisabledDuringTests } from '@vybestack/llxprt-code-core';
import open from 'open';
import process from 'node:process';
import { type SlashCommand, CommandKind } from './types.js';
import { MessageType } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

interface DocsCommandDependencies {
  readonly openUrl: (url: string) => Promise<unknown>;
  readonly isBrowserLaunchDisabledDuringTests: () => boolean;
}

const defaultDependencies: DocsCommandDependencies = {
  openUrl: open,
  isBrowserLaunchDisabledDuringTests,
};

export function createDocsCommand(
  addItem: UseHistoryManagerReturn['addItem'],
  dependencies: DocsCommandDependencies = defaultDependencies,
): SlashCommand {
  return {
    name: 'docs',
    description: 'open full LLxprt Code documentation in your browser',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<void> => {
      const docsUrl =
        'https://github.com/vybestack/llxprt-code/blob/main/docs/index.md';
      const sandboxEnvironment = process.env.SANDBOX;
      const isRestrictedSandbox =
        sandboxEnvironment !== undefined &&
        sandboxEnvironment !== '' &&
        sandboxEnvironment !== 'sandbox-exec';
      const requiresManualOpen =
        isRestrictedSandbox ||
        dependencies.isBrowserLaunchDisabledDuringTests();

      if (requiresManualOpen) {
        addItem(
          {
            type: MessageType.INFO,
            text: `Please open the following URL in your browser to view the documentation:\n${docsUrl}`,
          },
          Date.now(),
        );
      } else {
        addItem(
          {
            type: MessageType.INFO,
            text: `Opening documentation in your browser: ${docsUrl}`,
          },
          Date.now(),
        );
        await dependencies.openUrl(docsUrl);
      }
    },
  };
}
