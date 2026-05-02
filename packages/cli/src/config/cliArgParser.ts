/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 */

import yargs from 'yargs/yargs';
import type { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import { mcpCommand } from '../commands/mcp.js';
import { skillsCommand } from '../commands/skills.js';
import { hooksCommand } from '../commands/hooks.js';
import { extensionsCommand } from '../commands/extensions.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { getEnableHooksUI } from './settingsSchema.js';
import { getCliVersion } from '../utils/version.js';
import type { Settings } from './settings.js';
import {
  innerCommandOptions,
  rootOptions,
  deprecatedOptions,
} from './yargsOptions.js';

const logger = new DebugLogger('llxprt:config:cliArgParser');

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  sandboxEngine: string | undefined;
  sandboxProfileLoad: string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  outputFormat: string | undefined;

  showMemoryUsage: boolean | undefined;
  yolo: boolean | undefined;
  approvalMode: string | undefined;
  telemetry: boolean | undefined;
  checkpointing: boolean | undefined;
  telemetryTarget: string | undefined;
  telemetryOtlpEndpoint: string | undefined;
  telemetryLogPrompts: boolean | undefined;
  telemetryOutfile: string | undefined;
  allowedMcpServerNames: string[] | undefined;
  allowedTools: string[] | undefined;
  experimentalAcp: boolean | undefined;
  experimentalUi: boolean | undefined;
  extensions: string[] | undefined;
  listExtensions: boolean | undefined;
  provider: string | undefined;
  key: string | undefined;
  keyfile: string | undefined;
  baseurl: string | undefined;
  proxy: string | undefined;
  includeDirectories: string[] | undefined;
  profileLoad: string | undefined;
  loadMemoryFromIncludeDirectories: boolean | undefined;
  ideMode: string | undefined;
  screenReader: boolean | undefined;
  sessionSummary: string | undefined;
  dumponerror: boolean | undefined;
  promptWords: string[] | undefined;
  query: string | undefined;
  set: string[] | undefined;
  /** @plan PLAN-20260211-SESSIONRECORDING.P24 — widened to support --continue <session-id> */
  continue: string | boolean | undefined;
  nobrowser: boolean | undefined;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 — list recorded sessions */
  listSessions: boolean | undefined;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 — delete a recorded session by ref */
  deleteSession: string | undefined;
}

/** Creates the base yargs instance with locale and usage. */
function buildRootYargs(): Argv {
  return yargs(hideBin(process.argv))
    .locale('en')
    .scriptName('llxprt')
    .usage(
      '$0 [options]',
      'LLxprt Code - Launch an interactive CLI, use -p/--prompt for non-interactive mode',
    );
}

/**
 * Wires all subcommands based on settings feature flags.
 * mcpCommand is always registered; others depend on feature flags.
 */
function registerCommands(yargsInstance: Argv, settings: Settings): Argv {
  if (getEnableHooksUI(settings)) {
    yargsInstance.command(hooksCommand);
  }

  if (settings.extensionManagement ?? false) {
    yargsInstance.command(extensionsCommand);
  }

  if (settings.experimental?.skills ?? false) {
    yargsInstance.command(skillsCommand);
  }

  return yargsInstance;
}

/** Applies all inner-command option definitions from yargsOptions.ts. */
function applyInnerOptions(innerYargs: Argv): Argv {
  for (const [name, def] of Object.entries(innerCommandOptions)) {
    innerYargs.option(name, def);
  }
  return innerYargs;
}

/** Applies all root-scope option definitions from yargsOptions.ts. */
function applyRootOptions(yargsInstance: Argv): Argv {
  for (const [name, def] of Object.entries(rootOptions)) {
    yargsInstance.option(name, def);
  }
  return yargsInstance;
}

/** Applies deprecation warnings for deprecated options. */
function applyDeprecations(innerYargs: Argv): Argv {
  for (const { key, message } of deprecatedOptions) {
    innerYargs.deprecateOption(key, message);
  }
  return innerYargs;
}

/**
 * Maps the raw yargs parse result to the typed CliArgs interface.
 * Handles promptWords → prompt/query normalization.
 */
function mapParsedArgsToCliArgs(result: Record<string, unknown>): CliArgs {
  const promptWords = result['promptWords'] as string[] | undefined;
  const promptWordsFiltered =
    promptWords?.filter((word) => word.trim() !== '') ?? [];
  const queryFromPromptWords =
    promptWordsFiltered.length > 0 ? promptWordsFiltered.join(' ') : undefined;

  logger.debug(
    () =>
      `Mapped promptWords: ${JSON.stringify(promptWords)} → query: ${queryFromPromptWords}`,
  );

  return {
    model: result['model'] as string | undefined,
    sandbox: result['sandbox'] as boolean | string | undefined,
    sandboxImage: result['sandboxImage'] as string | undefined,
    sandboxEngine: result['sandboxEngine'] as string | undefined,
    sandboxProfileLoad: result['sandboxProfileLoad'] as string | undefined,
    debug: result['debug'] as boolean | undefined,
    prompt:
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string should fall through to queryFromPromptWords
      (result['prompt'] as string | undefined) ||
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string should fall through to undefined
      queryFromPromptWords ||
      undefined,
    promptInteractive: result['promptInteractive'] as string | undefined,
    outputFormat: result['outputFormat'] as string | undefined,
    showMemoryUsage: result['showMemoryUsage'] as boolean | undefined,
    yolo: result['yolo'] as boolean | undefined,
    approvalMode: result['approvalMode'] as string | undefined,
    telemetry: result['telemetry'] as boolean | undefined,
    checkpointing: result['checkpointing'] as boolean | undefined,
    telemetryTarget: result['telemetryTarget'] as string | undefined,
    telemetryOtlpEndpoint: result['telemetryOtlpEndpoint'] as
      | string
      | undefined,
    telemetryLogPrompts: result['telemetryLogPrompts'] as boolean | undefined,
    telemetryOutfile: result['telemetryOutfile'] as string | undefined,
    allowedMcpServerNames: result['allowedMcpServerNames'] as
      | string[]
      | undefined,
    allowedTools: result['allowedTools'] as string[] | undefined,
    experimentalAcp: result['experimentalAcp'] as boolean | undefined,
    experimentalUi: result['experimentalUi'] as boolean | undefined,
    extensions: result['extensions'] as string[] | undefined,
    listExtensions: result['listExtensions'] as boolean | undefined,
    provider: result['provider'] as string | undefined,
    key: result['key'] as string | undefined,
    keyfile: result['keyfile'] as string | undefined,
    baseurl: result['baseurl'] as string | undefined,
    proxy: result['proxy'] as string | undefined,
    includeDirectories: result['includeDirectories'] as string[] | undefined,
    profileLoad: result['profileLoad'] as string | undefined,
    loadMemoryFromIncludeDirectories: result[
      'loadMemoryFromIncludeDirectories'
    ] as boolean | undefined,
    ideMode: result['ideMode'] as string | undefined,
    screenReader: result['screenReader'] as boolean | undefined,
    sessionSummary: result['sessionSummary'] as string | undefined,
    dumponerror: result['dumponerror'] as boolean | undefined,
    promptWords: result['promptWords'] as string[] | undefined,
    query: queryFromPromptWords,
    set: result['set'] as string[] | undefined,
    continue: result['continue'] as string | boolean | undefined,
    nobrowser: result['nobrowser'] as boolean | undefined,
    listSessions: result['listSessions'] as boolean | undefined,
    deleteSession: result['deleteSession'] as string | undefined,
  };
}

/** Checks for subcommand dispatch (mcp, hooks, extensions) and exits if handled. */
function handleSubcommandExit(result: Record<string, unknown>): void {
  const commands = result['_'];
  if (!Array.isArray(commands) || commands.length === 0) {
    return;
  }

  const first = commands[0];
  if (first === 'mcp') {
    process.exit(0);
  }
  if (first === 'hooks') {
    process.exit(0);
  }
  if (first === 'extensions' || first === 'extension' || first === 'ext') {
    process.exit(0);
  }
}

/**
 * Parses process.argv and returns a typed CliArgs object.
 * Subcommand handlers (mcp, hooks, extensions, skills) call process.exit(0) when invoked.
 */
export async function parseArguments(settings: Settings): Promise<CliArgs> {
  const yargsInstance = buildRootYargs();

  yargsInstance.command(
    '$0 [promptWords...]',
    'Launch LLxprt CLI',
    (innerYargs) => {
      applyInnerOptions(innerYargs);
      applyDeprecations(innerYargs);

      innerYargs
        .positional('promptWords', {
          describe: 'Prompt to run non-interactively',
          type: 'string',
          array: true,
        })
        .check((argv) => {
          const pw = argv['promptWords'];
          if (
            typeof argv['prompt'] === 'string' &&
            argv['prompt'].length > 0 &&
            Array.isArray(pw) &&
            pw.length > 0
          ) {
            throw new Error(
              'Cannot use both a positional prompt and the --prompt (-p) flag together',
            );
          }
          if (
            typeof argv['prompt'] === 'string' &&
            argv['prompt'].length > 0 &&
            typeof argv['promptInteractive'] === 'string' &&
            argv['promptInteractive'].length > 0
          ) {
            throw new Error(
              'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
            );
          }
          if (argv['yolo'] === true && argv['approvalMode'] != null) {
            throw new Error(
              'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
            );
          }
          return true;
        });
    },
  );

  registerCommands(yargsInstance, settings);
  applyRootOptions(yargsInstance);

  // Register MCP subcommand at root scope (always present)
  yargsInstance.command(mcpCommand);

  yargsInstance
    .version(await getCliVersion())
    .alias('v', 'version')
    .help()
    .alias('h', 'help')
    .strict()
    .check((argv) => {
      if (
        typeof argv['prompt'] === 'string' &&
        argv['prompt'].length > 0 &&
        typeof argv['promptInteractive'] === 'string' &&
        argv['promptInteractive'].length > 0
      ) {
        throw new Error(
          'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
        );
      }
      if (
        typeof argv['profile'] === 'string' &&
        argv['profile'].length > 0 &&
        typeof argv['profileLoad'] === 'string' &&
        argv['profileLoad'].length > 0
      ) {
        throw new Error(
          'Cannot use both --profile and --profile-load. Use one at a time.',
        );
      }
      return true;
    });

  yargsInstance.wrap(yargsInstance.terminalWidth());
  const result = await yargsInstance.parseAsync();

  handleSubcommandExit(result as Record<string, unknown>);

  return mapParsedArgsToCliArgs(result as Record<string, unknown>);
}
