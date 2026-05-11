/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { getDirectoryContextString } from '../utils/environmentContext.js';
import type { AgentInputs } from './types.js';
import { templateString } from './utils.js';

const TASK_COMPLETE_TOOL_NAME = 'complete_task';

/**
 * Build the system prompt for an agent execution.
 */
export async function buildAgentSystemPrompt(
  inputs: AgentInputs,
  runtimeContext: Config,
  systemPromptTemplate: string,
): Promise<string> {
  // Inject user inputs into the prompt template.
  let finalPrompt = templateString(systemPromptTemplate, inputs);

  // Append environment context (CWD and folder structure).
  const dirContext = await getDirectoryContextString(runtimeContext);
  finalPrompt += `\n\n# Environment Context\n${dirContext}`;

  // Append standard rules for non-interactive execution.
  finalPrompt += `
Important Rules:
* You are running in a non-interactive mode. You CANNOT ask the user for input or clarification.
* Work systematically using available tools to complete your task.
* Always use absolute paths for file operations. Construct them using the provided "Environment Context".`;

  finalPrompt += `
* When you have completed your task, you MUST call the \`${TASK_COMPLETE_TOOL_NAME}\` tool.
* Do not call any other tools in the same turn as \`${TASK_COMPLETE_TOOL_NAME}\`.
* This is the ONLY way to complete your mission. If you stop calling tools without calling this, you have failed.`;

  return finalPrompt;
}

/**
 * Apply template strings to initial messages.
 */
export function applyTemplateToInitialMessages<
  T extends { parts?: Array<{ text?: string } | object> },
>(initialMessages: T[], inputs: AgentInputs): T[] {
  return initialMessages.map((content) => {
    const newParts = (content.parts ?? []).map((part) => {
      if ('text' in part && part.text !== undefined) {
        return { text: templateString(part.text, inputs) };
      }
      return part;
    });
    return { ...content, parts: newParts } as T;
  });
}
