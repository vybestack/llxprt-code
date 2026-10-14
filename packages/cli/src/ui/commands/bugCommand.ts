/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLaunchDisabledDuringTests } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core';
import open from 'open';
import process from 'node:process';
import { type SlashCommand, CommandKind } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { MessageType } from '../types.js';
import { getGitCommitInfo } from '../../utils/gitCommitInfo.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';
import { exportHistoryForBugReport } from '../utils/historyExportUtils.js';

export interface BugCommandOperations {
  readonly getModel: () => string;
  readonly getReportUrlTemplate: () => string | undefined;
  readonly getIdeDisplayName: () => string;
  readonly getConversationHistory: () => readonly IContent[] | undefined;
  readonly addItem: UseHistoryManagerReturn['addItem'];
}

interface BugCommandDependencies extends BugCommandOperations {
  readonly openUrl: (url: string) => Promise<unknown>;
  readonly isBrowserLaunchDisabledDuringTests: () => boolean;
}

const defaultEnvironment = {
  openUrl: open,
  isBrowserLaunchDisabledDuringTests,
};

function getSandboxEnv(): string {
  if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
    return process.env.SANDBOX.replace(/^gemini-(?:code-)?/, '');
  }
  if (process.env.SANDBOX === 'sandbox-exec') {
    return `sandbox-exec (${process.env.SEATBELT_PROFILE ?? 'unknown'})`;
  }
  return 'no sandbox';
}

async function buildBugInfo(operations: BugCommandOperations): Promise<string> {
  const osVersion = `${process.platform} ${process.version}`;
  const sandboxEnv = getSandboxEnv();
  const modelVersion = operations.getModel();
  const cliVersion = await getCliVersion();
  const gitCommitInfo = getGitCommitInfo();
  const memoryUsage = formatMemoryUsage(process.memoryUsage().rss);
  const ideClient = operations.getIdeDisplayName();
  const terminalName = terminalCapabilityManager.getTerminalName() ?? 'Unknown';
  const terminalBgColor =
    terminalCapabilityManager.getTerminalBackgroundColor() ?? 'Unknown';
  const kittyProtocol = terminalCapabilityManager.isKittyProtocolEnabled()
    ? 'Supported'
    : 'Unsupported';

  let info = `
* **CLI Version:** ${cliVersion}
* **Git Commit:** ${gitCommitInfo}
* **Operating System:** ${osVersion}
* **Sandbox Environment:** ${sandboxEnv}
* **Model Version:** ${modelVersion}
* **Memory Usage:** ${memoryUsage}
* **Terminal Name:** ${terminalName}
* **Terminal Background:** ${terminalBgColor}
* **Kitty Keyboard Protocol:** ${kittyProtocol}
`;
  if (ideClient !== '') {
    info += `* **IDE Client:** ${ideClient}\n`;
  }

  return info;
}

async function appendHistoryExport(
  dependencies: BugCommandDependencies,
  info: string,
): Promise<string> {
  const history = dependencies.getConversationHistory();
  if (history === undefined || history.length === 0) {
    return info;
  }

  try {
    const { filePath } = await exportHistoryForBugReport([...history]);
    info += `* **Conversation Transcript:** Exported to \`${filePath}\` (please attach to your bug report)\n`;

    dependencies.addItem(
      {
        type: MessageType.INFO,
        text: `Conversation history exported to: ${filePath}`,
      },
      Date.now(),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    dependencies.addItem(
      {
        type: MessageType.WARNING,
        text: `Warning: Could not export conversation history: ${errorMessage}`,
      },
      Date.now(),
    );
  }

  return info;
}

function buildBugReportUrl(
  info: string,
  bugDescription: string,
  operations: BugCommandOperations,
): string {
  let bugReportUrl =
    'https://github.com/vybestack/llxprt-code/issues/new?template=bug_report.yml&title={title}&info={info}';

  const template = operations.getReportUrlTemplate();
  if (template) {
    bugReportUrl = template;
  }

  return bugReportUrl
    .replace('{title}', encodeURIComponent(bugDescription))
    .replace('{info}', encodeURIComponent(info));
}

async function openBugReport(
  dependencies: BugCommandDependencies,
  bugReportUrl: string,
): Promise<void> {
  dependencies.addItem(
    {
      type: MessageType.INFO,
      text: `To submit your bug report, please open the following URL in your browser:\n${bugReportUrl}`,
    },
    Date.now(),
  );

  if (dependencies.isBrowserLaunchDisabledDuringTests()) {
    return;
  }

  try {
    await dependencies.openUrl(bugReportUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    dependencies.addItem(
      {
        type: MessageType.ERROR,
        text: `Could not open URL in browser: ${errorMessage}`,
      },
      Date.now(),
    );
  }
}

export function createBugCommand(
  operations: BugCommandOperations,
  environment: Pick<
    BugCommandDependencies,
    'openUrl' | 'isBrowserLaunchDisabledDuringTests'
  > = defaultEnvironment,
): SlashCommand {
  const dependencies: BugCommandDependencies = {
    ...operations,
    ...environment,
  };
  return {
    name: 'bug',
    description: 'submit a bug report',
    kind: CommandKind.BUILT_IN,
    action: async (_context, args?: string): Promise<void> => {
      const bugDescription = (args ?? '').trim();
      const info = await buildBugInfo(dependencies);
      const infoWithHistory = await appendHistoryExport(dependencies, info);
      const bugReportUrl = buildBugReportUrl(
        infoWithHistory,
        bugDescription,
        dependencies,
      );
      await openBugReport(dependencies, bugReportUrl);
    },
  };
}
