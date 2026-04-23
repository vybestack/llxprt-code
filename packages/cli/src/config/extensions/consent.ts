/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { debugLogger, type SkillDefinition } from '@vybestack/llxprt-code-core';
import chalk from 'chalk';

import type { ConfirmationRequest } from '../../ui/types.js';
import { escapeAnsiCtrlCodes } from '../../ui/utils/textUtils.js';
import type { ExtensionConfig } from '../extension.js';

export const INSTALL_WARNING_MESSAGE = chalk.yellow(
  'The extension you are about to install may have been created by a third-party developer and sourced from a public repository. Please carefully inspect any extension and its source code before installing to understand the permissions it requires and the actions it may perform.',
);

export const SKILLS_WARNING_MESSAGE = chalk.yellow(
  "Skills inject specialized instructions and domain-specific knowledge into the agent's system prompt. This can change how the agent interprets your requests and interacts with your environment. Review the skill definitions at the location(s) provided below to ensure they meet your security standards.",
);

/**
 * Extension hooks consent handling.
 *
 * Prompts users before enabling extension hooks to ensure they understand
 * the security implications.
 */

/**
 * Computes the delta between current and previous hook definitions.
 *
 * @param currentHooks - Current hook definitions
 * @param previousHooks - Previous hook definitions
 * @returns Object containing arrays of new and changed hook names
 */
export function computeHookConsentDelta(
  currentHooks: Record<string, unknown> | undefined,
  previousHooks: Record<string, unknown> | undefined,
): { newHooks: string[]; changedHooks: string[] } {
  const current = currentHooks ?? {};
  const previous = previousHooks ?? {};
  const newHooks: string[] = [];
  const changedHooks: string[] = [];

  for (const name of Object.keys(current)) {
    if (!(name in previous)) {
      newHooks.push(name);
    } else {
      const prevKeys = Object.keys(previous[name] as Record<string, unknown>);
      const currKeys = Object.keys(current[name] as Record<string, unknown>);
      const prevJson = JSON.stringify(previous[name], prevKeys.sort());
      const currJson = JSON.stringify(current[name], currKeys.sort());
      if (prevJson !== currJson) {
        changedHooks.push(name);
      }
    }
  }

  return { newHooks, changedHooks };
}

/**
 * Builds a consent prompt string for hook registration.
 *
 * @param extensionName - Name of the extension requesting hook registration
 * @param hookNames - Array of hook names the extension wants to register
 * @returns Formatted consent prompt string
 */
export function buildHookConsentPrompt(
  extensionName: string,
  hookNames: string[],
): string {
  const sanitizedExtensionName = escapeAnsiCtrlCodes(extensionName);
  const sanitizedHookNames = hookNames.map((name) => escapeAnsiCtrlCodes(name));

  const lines: string[] = [];
  lines.push('');
  lines.push('WARNING:  Extension Hook Security Warning');
  lines.push('━'.repeat(60));
  lines.push('');
  lines.push(
    `Extension "${sanitizedExtensionName}" wants to register the following hooks:`,
  );
  lines.push('');

  for (const hookName of sanitizedHookNames) {
    lines.push(`  • ${hookName}`);
  }

  lines.push('');
  lines.push('Hooks can intercept and modify LLxprt Code behavior.');
  lines.push('Only enable hooks from extensions you trust.');
  lines.push('');
  lines.push('Learn more: https://docs.vybestack.com/extensions/hooks');
  lines.push('');

  return lines.join('\n');
}

/**
 * Requests user consent before enabling extension hooks.
 *
 * Shows which hooks the extension wants to register and asks for user consent.
 * Returns true if user consents, false otherwise.
 *
 * @param extensionName - Name of the extension requesting hook registration
 * @param hookNames - Array of hook names the extension wants to register
 * @param requestConsent - Optional callback to request consent (for testing)
 * @returns Promise resolving to true if user consents, false otherwise
 * @throws Error if in non-interactive context and no requestConsent callback provided
 */
export async function requestHookConsent(
  extensionName: string,
  hookNames: string[],
  requestConsent?: (prompt: string) => Promise<boolean>,
): Promise<boolean> {
  if (hookNames.length === 0) {
    return true;
  }

  const consentPrompt = buildHookConsentPrompt(extensionName, hookNames);

  if (requestConsent) {
    return requestConsent(consentPrompt);
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Cannot install extension "${extensionName}" with hooks in non-interactive mode. ` +
        `Hooks require user consent: ${hookNames.join(', ')}`,
    );
  }

  debugLogger.log(consentPrompt);

  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sanitizedExtensionName = escapeAnsiCtrlCodes(extensionName);

  return new Promise<boolean>((resolve) => {
    rl.question('Enable these hooks? [y/N]: ', (answer) => {
      rl.close();
      const consent = answer.trim().toLowerCase() === 'y';
      if (consent) {
        debugLogger.log(
          `✓ Hooks enabled for extension "${sanitizedExtensionName}".`,
        );
      } else {
        debugLogger.log(
          ` Hooks not enabled for extension "${sanitizedExtensionName}".`,
        );
      }
      debugLogger.log('');
      resolve(consent);
    });
  });
}

/**
 * Requests consent from the user to perform an action, by reading a Y/n
 * character from stdin.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param consentDescription The description of the thing they will be consenting to.
 * @returns boolean, whether they consented or not.
 */
export async function requestConsentNonInteractive(
  consentDescription: string,
): Promise<boolean> {
  debugLogger.log(consentDescription);
  const result = await promptForConsentNonInteractive(
    'Do you want to continue? [Y/n]: ',
  );
  return result;
}

/**
 * Requests consent from the user to perform an action, in interactive mode.
 *
 * This should not be called from non-interactive mode as it will not work.
 *
 * @param consentDescription The description of the thing they will be consenting to.
 * @param addExtensionUpdateConfirmationRequest A function to actually add a prompt to the UI.
 * @returns boolean, whether they consented or not.
 */
export async function requestConsentInteractive(
  consentDescription: string,
  addExtensionUpdateConfirmationRequest: (value: ConfirmationRequest) => void,
): Promise<boolean> {
  return promptForConsentInteractive(
    consentDescription + '\n\nDo you want to continue?',
    addExtensionUpdateConfirmationRequest,
  );
}

/**
 * Asks users a prompt and awaits for a y/n response on stdin.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param prompt A yes/no prompt to ask the user
 * @returns Whether or not the user answers 'y' (yes). Defaults to 'yes' on enter.
 */
async function promptForConsentNonInteractive(
  prompt: string,
): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(['y', ''].includes(answer.trim().toLowerCase()));
    });
  });
}

/**
 * Asks users an interactive yes/no prompt.
 *
 * This should not be called from non-interactive mode as it will break the CLI.
 *
 * @param prompt A markdown prompt to ask the user
 * @param addExtensionUpdateConfirmationRequest Function to update the UI state with the confirmation request.
 * @returns Whether or not the user answers yes.
 */
async function promptForConsentInteractive(
  prompt: string,
  addExtensionUpdateConfirmationRequest: (value: ConfirmationRequest) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    addExtensionUpdateConfirmationRequest({
      prompt,
      onConfirm: (resolvedConfirmed) => {
        resolve(resolvedConfirmed);
      },
    });
  });
}

/**
 * Renders a list of skills for a consent prompt.
 */
async function renderSkillsList(skills: SkillDefinition[]): Promise<string[]> {
  const output: string[] = [];
  for (const skill of skills) {
    output.push(`  * ${chalk.bold(skill.name)}: ${skill.description}`);
    const skillDir = path.dirname(skill.location);
    let fileCountStr = '';
    try {
      const skillDirItems = await fs.readdir(skillDir);
      fileCountStr = ` (${skillDirItems.length} items in directory)`;
    } catch {
      fileCountStr = ` ${chalk.red('(Could not count items in directory)')}`;
    }
    output.push(`    (Location: ${skill.location})${fileCountStr}`);
    output.push('');
  }
  return output;
}

/**
 * Builds a consent string for installing standalone skills (not via extension).
 */
export async function skillsConsentString(
  skills: SkillDefinition[],
  source: string,
  targetDir?: string,
): Promise<string> {
  const output: string[] = [];
  output.push(`Installing agent skill(s) from "${source}".`);
  output.push('\nThe following agent skill(s) will be installed:\n');
  output.push(...(await renderSkillsList(skills)));
  if (targetDir) {
    output.push(`Install Destination: ${targetDir}`);
  }
  output.push('\n' + SKILLS_WARNING_MESSAGE);
  return output.join('\n');
}

/**
 * Builds a consent string for installing an extension based on its
 * extensionConfig.
 */
async function extensionConsentString(
  extensionConfig: ExtensionConfig,
  hasHooks: boolean,
  skills: SkillDefinition[] = [],
): Promise<string> {
  const sanitizedConfig = escapeAnsiCtrlCodes(extensionConfig);
  const output: string[] = [];
  const mcpServerEntries = Object.entries(sanitizedConfig.mcpServers ?? {});
  output.push(`Installing extension "${sanitizedConfig.name}".`);
  output.push(INSTALL_WARNING_MESSAGE);

  if (mcpServerEntries.length) {
    output.push('This extension will run the following MCP servers:');
    for (const [key, mcpServer] of mcpServerEntries) {
      const isLocal = !!mcpServer.command;
      const source =
        mcpServer.httpUrl ??
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string fallback for command display
        `${mcpServer.command || ''}${mcpServer.args ? ' ' + mcpServer.args.join(' ') : ''}`;
      output.push(`  * ${key} (${isLocal ? 'local' : 'remote'}): ${source}`);
    }
  }
  if (sanitizedConfig.contextFileName) {
    output.push(
      `This extension will append info to your LLXPRT.md context using ${sanitizedConfig.contextFileName}`,
    );
  }
  if (sanitizedConfig.excludeTools) {
    output.push(
      `This extension will exclude the following core tools: ${sanitizedConfig.excludeTools}`,
    );
  }
  if (hasHooks) {
    output.push(
      'This extension contains Hooks which can automatically execute commands.',
    );
  }
  if (skills.length > 0) {
    output.push(`\n${chalk.bold('Skills:')}`);
    output.push(SKILLS_WARNING_MESSAGE);
    output.push('This extension will install the following skills:');
    output.push(...(await renderSkillsList(skills)));
  }
  return output.join('\n');
}

/**
 * Requests consent from the user to install an extension (extensionConfig), if
 * there is any difference between the consent string for `extensionConfig` and
 * `previousExtensionConfig`.
 *
 * Always requests consent if previousExtensionConfig is null.
 *
 * Throws if the user does not consent.
 */
export async function maybeRequestConsentOrFail(
  extensionConfig: ExtensionConfig,
  requestConsent: (consent: string) => Promise<boolean>,
  hasHooks: boolean,
  previousExtensionConfig?: ExtensionConfig,
  previousHasHooks?: boolean,
  skills: SkillDefinition[] = [],
  previousSkills: SkillDefinition[] = [],
) {
  const extensionConsent = await extensionConsentString(
    extensionConfig,
    hasHooks,
    skills,
  );
  if (previousExtensionConfig) {
    const previousExtensionConsent = await extensionConsentString(
      previousExtensionConfig,
      previousHasHooks ?? false,
      previousSkills,
    );
    if (previousExtensionConsent === extensionConsent) {
      return;
    }
  }
  if (!(await requestConsent(extensionConsent))) {
    throw new Error(`Installation cancelled for "${extensionConfig.name}".`);
  }
}
