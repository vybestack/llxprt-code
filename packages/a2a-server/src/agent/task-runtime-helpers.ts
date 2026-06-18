/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isNodeError,
  EDIT_TOOL_NAMES,
  processRestorableToolCalls,
  type ServerGeminiStreamEvent,
  type Config,
  type ToolSchedulerContract,
  type CompletedToolCall,
  type ToolCall,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import {
  getAllMCPServerStatuses,
  MCPServerStatus,
} from '@vybestack/llxprt-code-mcp';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import type { DEFAULT_GUI_EDITOR } from '@vybestack/llxprt-code-core';
import type { AgentClient } from '@vybestack/llxprt-code-agents';
import type { PartUnion, Part as genAiPart } from '@google/genai';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import type { TaskMetadata } from '../types.js';
import { writeCheckpointsAndUpdateRequests } from './task-support.js';
import { applyReplacement } from './task-support.js';

/**
 * Scheduler config type alias used by Task to obtain a tool scheduler.
 */
export type SchedulerConfig = Config & {
  getOrCreateScheduler(
    sessionId: string,
    callbacks: {
      outputUpdateHandler: (toolCallId: string, chunk: string) => void;
      onAllToolCallsComplete: (
        completedToolCalls: CompletedToolCall[],
      ) => Promise<void>;
      onToolCallsUpdate: (toolCalls: ToolCall[]) => void;
      getPreferredEditor: () => typeof DEFAULT_GUI_EDITOR;
      onEditorClose: () => void;
    },
    options?: Record<string, unknown>,
    dependencies?: { messageBus?: MessageBus },
  ): Promise<ToolSchedulerContract>;
};

/**
 * Extracts the optional trace id from a server gemini stream event.
 */
export function getEventTraceId(
  event: ServerGeminiStreamEvent,
): string | undefined {
  return 'traceId' in event && typeof event.traceId === 'string'
    ? event.traceId
    : undefined;
}

/**
 * Resolves the model name, treating empty-string model values as "unset"
 * so they fall through to the content config default and the final fallback.
 */
export function resolveModel(
  configModel: string,
  contentConfigModel: string | undefined,
  fallback: string,
): string {
  if (configModel !== '') return configModel;
  if (contentConfigModel !== undefined && contentConfigModel !== '') {
    return contentConfigModel;
  }
  return fallback;
}

/**
 * Resolves a status timestamp, treating empty-string timestamps as invalid
 * and replacing them with the current time.
 */
export function resolveTimestamp(timestamp: string | undefined): string {
  if (timestamp !== undefined && timestamp !== '') {
    return timestamp;
  }
  return new Date().toISOString();
}

/**
 * Computes the proposed file content for a replace operation by applying
 * the replacement to the current file contents (or returning '' if the
 * file does not exist).
 */
export async function getProposedContent(
  filePath: string,
  oldString: string,
  newString: string,
): Promise<string> {
  try {
    const currentContent = fs.readFileSync(filePath, 'utf8');
    return applyReplacement(
      currentContent,
      oldString,
      newString,
      oldString === '' && currentContent === '',
    );
  } catch (err) {
    if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
    return '';
  }
}

/**
 * Converts a single tool response entry (which may be a string, a single
 * part, or an array of parts) into a normalized array of genai parts.
 */
export function normalizeResponseToGenAiParts(
  response: string | genAiPart | genAiPart[],
): genAiPart[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (typeof response === 'string') {
    return [{ text: response }];
  }
  return [response];
}

/**
 * Builds the flat list of LLM parts from a batch of completed tool calls by
 * concatenating each call's response parts.
 */
export function buildLlmPartsFromToolCalls(
  completedToolCalls: CompletedToolCall[],
): PartUnion[] {
  const llmParts: PartUnion[] = [];
  for (const completedToolCall of completedToolCalls) {
    const responseParts = completedToolCall.response.responseParts;
    if (Array.isArray(responseParts)) {
      llmParts.push(...responseParts);
    } else {
      llmParts.push(responseParts);
    }
  }
  return llmParts;
}

/**
 * Creates checkpoints for restorable (edit) tool calls when checkpointing is
 * enabled. Failures are logged but never thrown so tool execution proceeds.
 */
export async function createCheckpointsForRestorableTools(
  config: Config,
  updatedRequests: ToolCallRequestInfo[],
  agentClient: AgentClient,
): Promise<void> {
  if (!config.getCheckpointingEnabled()) {
    return;
  }

  try {
    const restorableRequests = updatedRequests.filter((r) =>
      EDIT_TOOL_NAMES.has(r.name),
    );

    if (restorableRequests.length === 0) {
      return;
    }

    logger.info(
      `[Task] Creating checkpoints for ${restorableRequests.length} restorable tool calls.`,
    );

    const gitService = await config.getGitService();
    const { checkpointsToWrite, toolCallToCheckpointMap, errors } =
      await processRestorableToolCalls(
        restorableRequests,
        gitService,
        agentClient,
      );

    if (errors.length > 0) {
      logger.warn(
        `[Task] Checkpoint creation had ${errors.length} errors: ${errors.join(', ')}`,
      );
    }

    if (checkpointsToWrite.size > 0) {
      const checkpointDir = config.storage.getProjectTempCheckpointsDir();
      await writeCheckpointsAndUpdateRequests(
        checkpointsToWrite,
        checkpointDir,
        toolCallToCheckpointMap,
        updatedRequests,
      );
    }
  } catch (checkpointError) {
    logger.warn(
      `[Task] Checkpoint creation failed, continuing with tool execution: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`,
    );
  }
}

/**
 * Builds the mcpServers and availableTools arrays for TaskMetadata from the
 * current config's tool registry and MCP server statuses.
 */
export function buildServerAndToolMetadata(
  config: Config,
): Pick<TaskMetadata, 'mcpServers' | 'availableTools'> {
  const toolRegistry = config.getToolRegistry();
  const mcpServers = config.getMcpServers() ?? {};
  const serverStatuses = getAllMCPServerStatuses();
  const servers = Object.keys(mcpServers).map((serverName) => ({
    name: serverName,
    status: serverStatuses.get(serverName) ?? MCPServerStatus.DISCONNECTED,
    tools: toolRegistry.getToolsByServer(serverName).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameterSchema: tool.schema.parameters,
    })),
  }));

  const availableTools = toolRegistry.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameterSchema: tool.schema.parameters,
  }));

  return { mcpServers: servers, availableTools };
}
