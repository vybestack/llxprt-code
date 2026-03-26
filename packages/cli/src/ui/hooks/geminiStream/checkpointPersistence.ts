/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useCheckpointPersistence — extracts the restorable tool-call checkpoint effect
 * from the orchestrator useGeminiStream hook.
 *
 * When a `replace` or `write_file` tool is awaiting approval, this hook saves
 * a JSON checkpoint with a git snapshot hash to the project temp directory,
 * enabling undo/restore workflows.
 *
 * The hook accepts an injectable `fsOps` parameter so tests can avoid real I/O.
 */

import { useEffect, useRef } from 'react';
import path from 'path';
import { promises as nodeFs } from 'fs';
import {
  Config,
  GeminiClient,
  GitService,
  getErrorMessage,
  isNodeError,
} from '@vybestack/llxprt-code-core';
import { TrackedToolCall } from '../useReactToolScheduler.js';
import { HistoryItem } from '../../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FsOps {
  mkdir: (
    dir: string,
    options: { recursive: boolean },
  ) => Promise<string | undefined>;
  writeFile: (path: string, data: string) => Promise<void>;
}

// ─── createToolCheckpoint ─────────────────────────────────────────────────────

/**
 * Creates a single checkpoint JSON file for a restorable tool call.
 * Accepts injected fsOps and gitService to enable testing without real I/O.
 *
 * @param toolCall - The tool call to checkpoint (replace/write_file).
 * @param checkpointDir - Directory to write the checkpoint file.
 * @param gitService - Git service for snapshot/commit hash resolution.
 * @param geminiClient - Gemini client for fetching current chat history.
 * @param history - Current UI history for checkpoint context.
 * @param onDebugMessage - Debug message callback.
 * @param fsOps - Injected filesystem operations (defaults to node:fs).
 */
export async function createToolCheckpoint(
  toolCall: TrackedToolCall,
  checkpointDir: string,
  gitService: GitService,
  geminiClient: GeminiClient,
  history: HistoryItem[],
  onDebugMessage: (message: string) => void,
  fsOps: FsOps = {
    mkdir: nodeFs.mkdir as FsOps['mkdir'],
    writeFile: nodeFs.writeFile as FsOps['writeFile'],
  },
): Promise<void> {
  const filePath = toolCall.request.args['file_path'] as string;
  if (!filePath) {
    onDebugMessage(
      `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
    );
    return;
  }

  let commitHash: string | undefined;
  try {
    commitHash = await gitService.createFileSnapshot(
      `Snapshot for ${toolCall.request.name}`,
    );
  } catch (error) {
    onDebugMessage(
      `Failed to create new snapshot: ${getErrorMessage(error)}. Attempting to use current commit.`,
    );
  }

  if (!commitHash) {
    commitHash = (await gitService.getCurrentCommitHash()) ?? undefined;
  }

  if (!commitHash) {
    onDebugMessage(
      `Failed to create snapshot for ${filePath}. Checkpointing may not be working properly. Ensure Git is installed and the project directory is accessible.`,
    );
    return;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '_');
  const toolName = toolCall.request.name;
  const fileName = path.basename(filePath);
  const checkpointFileName = `${timestamp}-${fileName}-${toolName}.json`;
  const checkpointFilePath = path.join(checkpointDir, checkpointFileName);

  const clientHistory = await geminiClient?.getHistory();

  await fsOps.writeFile(
    checkpointFilePath,
    JSON.stringify(
      {
        history,
        clientHistory,
        toolCall: {
          name: toolCall.request.name,
          args: toolCall.request.args,
        },
        commitHash,
        filePath,
      },
      null,
      2,
    ),
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Saves restorable tool calls as checkpoint JSON files.
 * Extracted from useCheckpointPersistence to keep the hook under 80 lines.
 */
async function saveRestorableToolCalls(
  toolCalls: TrackedToolCall[],
  config: Config,
  gitService: GitService | undefined,
  history: HistoryItem[],
  geminiClient: GeminiClient,
  storage: Config['storage'],
  onDebugMessage: (message: string) => void,
  fsOps?: FsOps,
  checkpointedCallIds?: Set<string>,
): Promise<void> {
  if (!config.getCheckpointingEnabled()) return;

  const restorableToolCalls = toolCalls.filter(
    (tc) =>
      (tc.request.name === 'replace' || tc.request.name === 'write_file') &&
      tc.status === 'awaiting_approval' &&
      !checkpointedCallIds?.has(tc.request.callId),
  );
  if (restorableToolCalls.length === 0) return;

  const checkpointDir = storage.getProjectTempCheckpointsDir();
  if (!checkpointDir) return;

  const effectiveFsOps: FsOps = fsOps ?? {
    mkdir: nodeFs.mkdir as FsOps['mkdir'],
    writeFile: nodeFs.writeFile as FsOps['writeFile'],
  };

  try {
    await effectiveFsOps.mkdir(checkpointDir, { recursive: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') {
      onDebugMessage(
        `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
      );
      return;
    }
  }

  for (const toolCall of restorableToolCalls) {
    if (!gitService) {
      const filePath = toolCall.request.args['file_path'] as string;
      onDebugMessage(
        `Checkpointing is enabled but Git service is not available. Failed to create snapshot for ${filePath ?? toolCall.request.name}. Ensure Git is installed and working properly.`,
      );
      continue;
    }
    // Reserve the callId before attempting the write to prevent
    // concurrent duplicate checkpoint attempts from a re-render.
    checkpointedCallIds?.add(toolCall.request.callId);
    try {
      await createToolCheckpoint(
        toolCall,
        checkpointDir,
        gitService,
        geminiClient,
        history,
        onDebugMessage,
        effectiveFsOps,
      );
    } catch (error) {
      // Remove reservation so the next effect run can retry.
      checkpointedCallIds?.delete(toolCall.request.callId);
      const filePath = toolCall.request.args['file_path'] as string;
      onDebugMessage(
        `Failed to create checkpoint for ${filePath}: ${getErrorMessage(error)}. This may indicate a problem with Git or file system permissions.`,
      );
    }
  }
}

/**
 * Runs the checkpoint persistence effect for restorable tool calls.
 *
 * @param toolCalls - All currently tracked tool calls.
 * @param config - App configuration (for checkpoint enable check + storage).
 * @param gitService - Git service (may be undefined if no project root).
 * @param history - Current UI history items.
 * @param geminiClient - Gemini client for fetching chat history.
 * @param storage - Storage service providing the checkpoint directory path.
 * @param onDebugMessage - Debug message callback.
 * @param fsOps - Injected filesystem operations (defaults to node:fs, override in tests).
 */
export function useCheckpointPersistence(
  toolCalls: TrackedToolCall[],
  config: Config,
  gitService: GitService | undefined,
  history: HistoryItem[],
  geminiClient: GeminiClient,
  storage: Config['storage'],
  onDebugMessage: (message: string) => void,
  fsOps?: FsOps,
): void {
  const checkpointedCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Clear checkpointed tracking for callIds no longer in the tool list,
    // so that if a tool is re-scheduled it can be checkpointed again.
    const activeCallIds = new Set(toolCalls.map((tc) => tc.request.callId));
    for (const id of checkpointedCallIdsRef.current) {
      if (!activeCallIds.has(id)) {
        checkpointedCallIdsRef.current.delete(id);
      }
    }

    void saveRestorableToolCalls(
      toolCalls,
      config,
      gitService,
      history,
      geminiClient,
      storage,
      onDebugMessage,
      fsOps,
      checkpointedCallIdsRef.current,
    );
  }, [
    toolCalls,
    config,
    onDebugMessage,
    gitService,
    history,
    geminiClient,
    storage,
    fsOps,
  ]);
}
