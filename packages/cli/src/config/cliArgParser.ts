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
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { getEnableHooksUI } from './settingsSchema.js';
import { getCliVersion } from '../utils/version.js';
import type { Settings } from './settings.js';
import {
  innerCommandOptions,
  rootOptions,
  deprecatedOptions,
} from './yargsOptions.js';
import { firstNonEmptyString } from '../utils/coalesce.js';

const logger = new DebugLogger('llxprt:config:cliArgParser');

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  sandboxEngine: string | undefined;
  sandboxProfileLoad: string | undefined;
  // Optional: only the parser sets it, so existing CliArgs literals may omit it.
  jspBootstrap?: string;
  /**
   * Hidden internal transport option. A memory or sandbox direct-replacement
   * relaunch carries an env-origin bootstrap path here so the child resolves it
   * without restoring LLXPRT_JSP_BOOTSTRAP_FILE to the environment. Never
   * user-facing.
   */
  jspBootstrapInternalEnvPath?: string;
  debug: boolean | string | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  outputFormat: string | undefined;
  quiet: boolean | undefined;

  showMemoryUsage: boolean | undefined;
  yolo: boolean | undefined;
  approvalMode: string | undefined;
  telemetry: boolean | undefined;
  checkpointing: boolean | undefined;
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
  imageInput: string[] | undefined;
  imageOutput: string | undefined;
  imagePrompt: string | undefined;
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
    jspBootstrap: result['jspBootstrap'] as string | undefined,
    jspBootstrapInternalEnvPath: result['jspBootstrapInternalEnvPath'] as
      | string
      | undefined,
    debug: result['debug'] as boolean | string | undefined,
    prompt: firstNonEmptyString(
      result['prompt'] as string | undefined,
      queryFromPromptWords,
    ),
    promptInteractive: result['promptInteractive'] as string | undefined,
    outputFormat: result['outputFormat'] as string | undefined,
    quiet: result['quiet'] as boolean | undefined,
    showMemoryUsage: result['showMemoryUsage'] as boolean | undefined,
    yolo: result['yolo'] as boolean | undefined,
    approvalMode: result['approvalMode'] as string | undefined,
    telemetry: result['telemetry'] as boolean | undefined,
    checkpointing: result['checkpointing'] as boolean | undefined,
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
    imageInput: result['imageInput'] as string[] | undefined,
    imageOutput: result['imageOutput'] as string | undefined,
    imagePrompt: result['imagePrompt'] as string | undefined,
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
function configureLaunchCommand(yargsInstance: Argv): void {
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
        .check(validateLaunchArgs);
    },
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * yargs coerces a `type: 'string'` option into an array when it is supplied
 * more than once (e.g. `-i a -i b` yields `['a', 'b']`). For single-valued
 * options that must stay a string, detect that repetition at parse time and
 * surface a clear error instead of letting a non-string flow downstream where
 * it would crash far from the cause (issue #2851 — `initialPrompt.trim`).
 */
function rejectRepeatedStringOption(
  argv: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (Array.isArray(argv[key])) {
    throw new Error(`${label} can only be specified once`);
  }
}

/**
 * Validates a required-value string option: it must not be bare/empty and must
 * not be repeated. yargs turns a bare `--flag` (no following value) into an
 * empty string for `type: 'string'`, and repeated occurrences into an array.
 * Both are surfaced as clear parse errors rather than silently falling through
 * to a different source (issue #3083 — the public flag must not silently fall
 * back to env when malformed).
 */
function rejectBareOrRepeatedStringOption(
  argv: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (Array.isArray(argv[key])) {
    throw new Error(`${label} can only be specified once`);
  }
  if (argv[key] === '') {
    throw new Error(`${label} requires a non-empty value`);
  }
}

function validateLaunchArgs(argv: Record<string, unknown>): true {
  const pw = argv['promptWords'];
  if (hasNonEmptyString(argv['prompt']) && Array.isArray(pw) && pw.length > 0) {
    throw new Error(
      'Cannot use both a positional prompt and the --prompt (-p) flag together',
    );
  }
  validatePromptModeArgs(argv);
  rejectBareOrRepeatedStringOption(argv, 'jspBootstrap', '--jsp-bootstrap');
  if (argv['yolo'] === true && argv['approvalMode'] != null) {
    throw new Error(
      'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
    );
  }
  return true;
}

function validatePromptModeArgs(argv: Record<string, unknown>): void {
  rejectRepeatedStringOption(argv, 'prompt', '--prompt (-p)');
  rejectRepeatedStringOption(
    argv,
    'promptInteractive',
    '--prompt-interactive (-i)',
  );
  if (
    hasNonEmptyString(argv['prompt']) &&
    hasNonEmptyString(argv['promptInteractive'])
  ) {
    throw new Error(
      'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
    );
  }
}

function validateRootArgs(argv: Record<string, unknown>): true {
  validatePromptModeArgs(argv);
  rejectBareOrRepeatedStringOption(
    argv,
    'jspBootstrapInternalEnvPath',
    '--jsp-bootstrap-internal-env-path',
  );
  if (
    hasNonEmptyString(argv['profile']) &&
    hasNonEmptyString(argv['profileLoad'])
  ) {
    throw new Error(
      'Cannot use both --profile and --profile-load. Use one at a time.',
    );
  }
  return true;
}

async function configureRootYargs(
  yargsInstance: Argv,
  settings: Settings,
): Promise<void> {
  configureLaunchCommand(yargsInstance);
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
    .check(validateRootArgs);
}

/**
 * Parses process.argv and returns a typed CliArgs object.
 * Subcommand handlers (mcp, hooks, extensions, skills) call process.exit(0) when invoked.
 */
export async function parseArguments(settings: Settings): Promise<CliArgs> {
  const yargsInstance = buildRootYargs();
  await configureRootYargs(yargsInstance, settings);
  yargsInstance.wrap(yargsInstance.terminalWidth());
  const result = await yargsInstance.parseAsync();

  handleSubcommandExit(result as Record<string, unknown>);

  return mapParsedArgsToCliArgs(result as Record<string, unknown>);
}
