/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import open from 'open';
import process from 'node:process';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';
import { exportHistoryForBugReport } from '../utils/historyExportUtils.js';

function getSandboxEnv(): string {
  if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
    return process.env.SANDBOX.replace(/^gemini-(?:code-)?/, '');
  }
  if (process.env.SANDBOX === 'sandbox-exec') {
    return `sandbox-exec (${process.env.SEATBELT_PROFILE ?? 'unknown'})`;
  }
  return 'no sandbox';
}

async function buildBugInfo(context: CommandContext): Promise<string> {
  const { config } = context.services;
  const osVersion = `${process.platform} ${process.version}`;
  const sandboxEnv = getSandboxEnv();
  const modelVersion = config?.getModel() ?? 'Unknown';
  const cliVersion = await getCliVersion();
  const memoryUsage = formatMemoryUsage(process.memoryUsage().rss);
  const ideClient =
    (config?.getIdeMode() === true &&
      config.getIdeClient()?.getDetectedIdeDisplayName()) ??
    '';
  const terminalName = terminalCapabilityManager.getTerminalName() ?? 'Unknown';
  const terminalBgColor =
    terminalCapabilityManager.getTerminalBackgroundColor() ?? 'Unknown';
  const kittyProtocol = terminalCapabilityManager.isKittyProtocolEnabled()
    ? 'Supported'
    : 'Unsupported';

  let info = `
* **CLI Version:** ${cliVersion}
* **Git Commit:** ${GIT_COMMIT_INFO}
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
  context: CommandContext,
  info: string,
): Promise<string> {
  const { config } = context.services;
  const client = config?.getGeminiClient();
  if (client?.hasChatInitialized() !== true) {
    return info;
  }

  try {
    const chat = client.getChat() as unknown;
    const getHistory =
      typeof chat === 'object' && chat !== null && 'getHistory' in chat
        ? chat.getHistory
        : undefined;
    const history =
      typeof getHistory === 'function' ? getHistory.call(chat) : undefined;

    if (Array.isArray(history) && history.length > 0) {
      const { filePath } = await exportHistoryForBugReport(history);
      info += `* **Conversation Transcript:** Exported to \`${filePath}\` (please attach to your bug report)\n`;

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `Conversation history exported to: ${filePath}`,
        },
        Date.now(),
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.ui.addItem(
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
  config: CommandContext['services']['config'],
): string {
  let bugReportUrl =
    'https://github.com/vybestack/llxprt-code/issues/new?template=bug_report.yml&title={title}&info={info}';

  const bugCommandSettings = config?.getBugCommand();
  if (bugCommandSettings?.urlTemplate) {
    bugReportUrl = bugCommandSettings.urlTemplate;
  }

  return bugReportUrl
    .replace('{title}', encodeURIComponent(bugDescription))
    .replace('{info}', encodeURIComponent(info));
}

async function openBugReport(
  context: CommandContext,
  bugReportUrl: string,
): Promise<void> {
  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `To submit your bug report, please open the following URL in your browser:\n${bugReportUrl}`,
    },
    Date.now(),
  );

  try {
    await open(bugReportUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: `Could not open URL in browser: ${errorMessage}`,
      },
      Date.now(),
    );
  }
}

export const bugCommand: SlashCommand = {
  name: 'bug',
  description: 'submit a bug report',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args?: string): Promise<void> => {
    const bugDescription = (args ?? '').trim();
    const info = await buildBugInfo(context);
    const infoWithHistory = await appendHistoryExport(context, info);
    const bugReportUrl = buildBugReportUrl(
      infoWithHistory,
      bugDescription,
      context.services.config,
    );
    await openBugReport(context, bugReportUrl);
  },
};
