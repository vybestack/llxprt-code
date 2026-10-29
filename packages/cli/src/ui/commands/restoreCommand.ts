/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import path from 'path';
import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type {
  IContent,
  WorkspaceCheckpointOperations,
} from '@vybestack/llxprt-code-core';
import {
  openDiskCheckpoint,
  type DiskCheckpoint,
} from './checkpoint-restore-source.js';

const checkpointSuggestionDescription = 'Restorable tool call checkpoint';

export interface RestoreCommandOperations {
  readonly enabled: boolean;
  readonly checkpointDirectory: string | undefined;
  readonly replaceHistoryFromSource: (
    rows: AsyncIterable<IContent>,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly git:
    | Pick<
        WorkspaceCheckpointOperations,
        | 'createFileSnapshot'
        | 'getCurrentCommitHash'
        | 'restoreProjectFromSnapshot'
      >
    | undefined;
}

function listCheckpoints(jsonFiles: string[]): SlashCommandActionReturn {
  if (jsonFiles.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No restorable tool calls found.',
    };
  }
  const files = jsonFiles.map((file) => file.replace(/\.json$/, ''));
  return {
    type: 'message',
    messageType: 'info',
    content: `Available tool calls to restore:\n\n${files.join('\n')}`,
  };
}

type CheckpointGit = NonNullable<RestoreCommandOperations['git']>;

/**
 * Rewrites the project files from a snapshot and can put them back.
 *
 * The history replacement is the step that can still fail after the files
 * change, and the replaced history cannot be recovered once published. The
 * files are therefore the side that rolls back: the working tree is captured
 * in a snapshot before the restore touches it, and `rollback` restores that
 * snapshot.
 */
interface ProjectFileRestore {
  restore(): Promise<void>;
  /** Returns the failure to report, joined with any rollback failure. */
  rollback(failure: unknown): Promise<unknown>;
}

function createProjectFileRestore(
  git: CheckpointGit | undefined,
  snapshot: string | undefined,
  signal: AbortSignal,
): ProjectFileRestore {
  let priorState: string | undefined;
  return {
    async restore() {
      signal.throwIfAborted();
      if (git === undefined || snapshot === undefined) return;
      const created = await git.createFileSnapshot('Project before /restore');
      // A snapshot of a tree identical to HEAD commits nothing and returns ''.
      priorState = created === '' ? await git.getCurrentCommitHash() : created;
      await git.restoreProjectFromSnapshot(snapshot);
      signal.throwIfAborted();
    },
    async rollback(failure) {
      if (git === undefined || priorState === undefined) return failure;
      try {
        await git.restoreProjectFromSnapshot(priorState);
      } catch (rollbackError) {
        return new AggregateError(
          [failure, rollbackError],
          `Restore failed and the project files could not be rolled back: ${String(failure)}; ${String(rollbackError)}`,
        );
      }
      return failure;
    },
  };
}

async function applyCheckpointRestoration(
  context: CommandContext,
  checkpoint: DiskCheckpoint,
  operations: RestoreCommandOperations,
): Promise<void> {
  const { data, rows } = checkpoint;
  const snapshot =
    typeof data.commitHash === 'string' && data.commitHash.length > 0
      ? data.commitHash
      : undefined;
  const files = createProjectFileRestore(
    operations.git,
    snapshot,
    context.signal,
  );
  try {
    if (rows !== undefined) {
      // The files change at the end of the admission source, before the
      // history is published; a later failure rolls them back below.
      await operations.replaceHistoryFromSource(
        (async function* () {
          yield* rows;
          await checkpoint.close();
          await files.restore();
        })(),
        context.signal,
      );
    } else {
      await checkpoint.close();
      await files.restore();
    }
  } catch (error) {
    throw await files.rollback(error);
  }
  context.ui.clear();
  if (snapshot !== undefined)
    context.ui.addItem(
      {
        type: 'info',
        text: 'Restored project to the state before the tool call.',
      },
      Date.now(),
    );
}

async function restoreFromDirectory(
  context: CommandContext,
  operations: RestoreCommandOperations,
  checkpointDirectory: string,
  args: string,
): Promise<SlashCommandActionReturn> {
  try {
    await fs.mkdir(checkpointDirectory, { recursive: true });
    const files = await fs.readdir(checkpointDirectory);
    const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();
    if (!args) return listCheckpoints(jsonFiles);

    const selectedFile = args.endsWith('.json') ? args : `${args}.json`;
    if (!jsonFiles.includes(selectedFile)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `File not found: ${selectedFile}`,
      };
    }
    const filePath = path.join(checkpointDirectory, selectedFile);
    const checkpoint = await openDiskCheckpoint(filePath, context.signal);
    try {
      await applyCheckpointRestoration(context, checkpoint, operations);
    } finally {
      await checkpoint.close();
    }
    return {
      type: 'tool',
      toolName: checkpoint.data.toolCall.name,
      toolArgs: checkpoint.data.toolCall.args,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Could not read restorable tool calls. This is the error: ${error}`,
    };
  }
}

export function createRestoreCommand(
  operations: RestoreCommandOperations,
  readFuzzyFiltering: () => boolean,
): SlashCommand | null {
  if (!operations.enabled) return null;

  const checkpointDirectory = operations.checkpointDirectory;
  const restoreSchema: CommandArgumentSchema = [
    {
      kind: 'value',
      name: 'checkpoint',
      description: 'Select checkpoint to restore',
      completer: withFuzzyFilter(async () => {
        if (!checkpointDirectory) return [];
        try {
          const files = await fs.readdir(checkpointDirectory);
          return files
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.replace(/\.json$/, ''))
            .sort()
            .map((name) => ({
              value: name,
              description: checkpointSuggestionDescription,
            }));
        } catch {
          return [];
        }
      }, readFuzzyFiltering),
    },
  ];

  return {
    name: 'restore',
    description:
      'Restore a tool call. This will reset the conversation and file history to the state it was in when the tool call was suggested',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    schema: restoreSchema,
    action: async (invocation, args) => {
      if (!checkpointDirectory) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Could not determine the configuration directory path.',
        };
      }
      return restoreFromDirectory(
        invocation,
        operations,
        checkpointDirectory,
        args,
      );
    },
  };
}
