/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { FileCommandLoader } from './services/FileCommandLoader.js';
import { bindShellPromptOperations } from './services/prompt-processors/shellPromptHost.js';
import {
  parseAndFormatApiError,
  FatalInputError,
  type AgentRequestInput,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { firstNonEmptyString } from './utils/coalesce.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  runNonInteractive,
  createProfileNameWriter,
  type NonInteractiveTurn,
} from './nonInteractiveCli.js';
import { processAgentStream } from './nonInteractiveCliSupport.js';
import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import { isSlashCommand } from './ui/utils/commandUtils.js';

type CommandFiles = NonNullable<
  ConstructorParameters<typeof FileCommandLoader>[0]
>;
type Shell = NonNullable<Parameters<typeof bindShellPromptOperations>[0]>;
export function createHeadlessCommandLoader(
  readUserCommandsDir: () => CommandFiles['userCommandsDir'],
  readProjectCommandsDir: () => CommandFiles['projectCommandsDir'],
  getProjectRoot: CommandFiles['getProjectRoot'],
  getExtensions: CommandFiles['getExtensions'],
  getFolderTrust: CommandFiles['getFolderTrust'],
  readTrust: () => CommandFiles['isTrustedFolder'] | undefined,
  getShellReplacement: Shell['getShellReplacement'],
  getExcludeTools: Shell['getExcludeTools'],
  getCoreTools: Shell['getCoreTools'],
  getApprovalMode: Shell['getApprovalMode'],
  getShellExecutionConfig: Shell['getShellExecutionConfig'],
  getTargetDir: Shell['getTargetDir'],
  getShouldUseNodePtyShell: Shell['getShouldUseNodePtyShell'],
) {
  return () => {
    const isTrustedFolder = readTrust();
    if (isTrustedFolder === undefined)
      throw new Error('File commands require the workspace trust authority');
    return new FileCommandLoader(
      {
        userCommandsDir: readUserCommandsDir(),
        projectCommandsDir: readProjectCommandsDir(),
        getProjectRoot,
        getExtensions,
        getFolderTrust,
        isTrustedFolder,
      },
      bindShellPromptOperations({
        getShellReplacement,
        getExcludeTools,
        getCoreTools,
        getApprovalMode,
        getShellExecutionConfig,
        getTargetDir,
        getShouldUseNodePtyShell,
      }),
    );
  };
}

export function createHeadlessFeedback(readDebugMode: () => boolean) {
  return (payload: UserFeedbackPayload) => {
    process.stderr.write(
      `[${payload.severity.toUpperCase()}] ${payload.message}\n`,
    );
    if (
      payload.error !== undefined &&
      payload.error !== null &&
      readDebugMode()
    ) {
      const detail =
        payload.error instanceof Error
          ? firstNonEmptyString(payload.error.stack, payload.error.message)
          : String(payload.error);
      process.stderr.write(`${detail}\n`);
    }
  };
}
export function createHeadlessErrorReporter(
  readProvider: () => string | undefined,
  readFallbackModel: (provider: string | undefined) => string | undefined,
) {
  return (error: unknown) => {
    const providerName = readProvider();
    debugLogger.error(
      parseAndFormatApiError(
        error,
        readFallbackModel(providerName),
        providerName,
      ),
    );
  };
}

type Run = Parameters<typeof runNonInteractive>;
type At = Parameters<typeof handleAtCommand>[0];
type Files = At['config'];
type Ignore = Files['ignore'];

export function createNonInteractiveRun(
  isConfigured: Run[2],
  reportUnconfigured: Run[3],
  readOutputFormat: Run[4],
  readDebugMode: Run[5],
  readSessionId: Run[6],
  readModel: Run[7],
  onFeedback: Run[8],
  readEmojiMode: Run[9],
  resolveSlash: Run[10],
  acquireTurn: Run[11],
  reportError: Run[12],
  flush: Run[13],
) {
  return (input: string, promptId: string, deferTelemetry = true) =>
    runNonInteractive(
      input,
      promptId,
      isConfigured,
      reportUnconfigured,
      readOutputFormat,
      readDebugMode,
      readSessionId,
      readModel,
      onFeedback,
      readEmojiMode,
      resolveSlash,
      acquireTurn,
      reportError,
      () => (deferTelemetry ? undefined : flush()),
    );
}

export function createHeadlessTurn(
  resolveInput: NonInteractiveTurn['resolveInput'],
  stream: Agent['stream'],
  readMaxTurns: () => number,
  readQuiet: () => boolean,
  readSessionId: () => string,
  readIncludeThinking: () => boolean,
  resolveIdentity: () => string | null,
  readMetrics: Parameters<typeof processAgentStream>[3],
  release: NonInteractiveTurn['release'],
): NonInteractiveTurn {
  return {
    resolveInput,
    release,
    stream: async (query, promptId, signal, output) => {
      const events = stream(query, {
        signal,
        promptId,
        maxTurns: readMaxTurns(),
      });
      await processAgentStream(
        events,
        {
          config: { getSessionId: readSessionId },
          ...output,
          quiet: readQuiet(),
          includeThinking: readIncludeThinking(),
          createProfileNameWriter: () =>
            createProfileNameWriter(
              output.jsonOutput,
              output.streamFormatter,
              resolveIdentity,
            ),
        },
        output.startTime,
        readMetrics,
      );
    },
  };
}

export function createHeadlessInput(
  readFiltering: Files['getFileFilteringOptions'],
  readRecursive: Files['getEnableRecursiveFileSearch'],
  shouldIgnoreFile: Ignore['shouldIgnoreFile'],
  shouldGitIgnoreFile: Ignore['shouldGitIgnoreFile'],
  shouldLlxprtIgnoreFile: Ignore['shouldLlxprtIgnoreFile'],
  filterFiles: Ignore['filterFiles'],
  filterFilesWithReport: Ignore['filterFilesWithReport'],
  getGlobExcludes: Ignore['getGlobExcludes'],
  getReadManyFilesExcludes: Ignore['getReadManyFilesExcludes'],
  directories: Files['directories'],
  contains: Files['contains'],
  getToolHandle: At['getToolHandle'],
  readResource: At['readResource'],
  findResource: At['findResource'],
): NonInteractiveTurn['resolveInput'] {
  return async (input, signal) => {
    const { processedQuery, error } = await handleAtCommand({
      query: input,
      signal,
      messageId: Date.now(),
      config: {
        getFileFilteringOptions: readFiltering,
        getEnableRecursiveFileSearch: readRecursive,
        ignore: {
          shouldIgnoreFile,
          shouldGitIgnoreFile,
          shouldLlxprtIgnoreFile,
          filterFiles,
          filterFilesWithReport,
          getGlobExcludes,
          getReadManyFilesExcludes,
        },
        directories,
        contains,
      },
      getToolHandle,
      readResource,
      findResource,
      addItem: () => 0,
      onDebugMessage: () => {},
    });
    if (error !== undefined || processedQuery === null)
      throw new FatalInputError(
        error !== undefined && error !== ''
          ? error
          : 'Exiting due to an error processing the @ command.',
      );
    return processedQuery;
  };
}

export function createHeadlessCommandRun(
  createLoader: Parameters<typeof handleSlashCommand>[2],
  readSessionId: Parameters<typeof handleSlashCommand>[3],
  readMetrics: Parameters<typeof handleSlashCommand>[4],
) {
  return (input: string, controller: AbortController) =>
    handleSlashCommand(
      input,
      controller,
      createLoader,
      readSessionId,
      readMetrics,
    );
}

export function resolveHeadlessSlash(
  hasSessionSettings: boolean,
  run: ReturnType<typeof createHeadlessCommandRun>,
) {
  return async (
    input: string,
    controller: AbortController,
  ): Promise<AgentRequestInput | undefined> => {
    if (!isSlashCommand(input)) return undefined;
    if (!hasSessionSettings)
      throw new Error(
        'Slash command settings require the explicit session owner',
      );
    const result = await run(input, controller);
    return result !== undefined &&
      (typeof result !== 'string' || result.length > 0)
      ? result
      : undefined;
  };
}
