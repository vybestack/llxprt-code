/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentInputs, ToolConfig } from './types.js';
import { templateString } from './utils.js';

const TASK_COMPLETE_TOOL_NAME = 'complete_task';

/**
 * Extracts declared tool-name strings from an agent's tool config.
 *
 * `ToolConfig.tools` is `Array<string | FunctionDeclaration | AnyDeclarativeTool>`,
 * narrowed here without assertions: string entries are names directly, tool
 * instances expose their declaration through `schema`, and raw
 * `FunctionDeclaration` objects carry an optional `name`.
 *
 * Used to tell `getCoreSystemPromptAsync` which tools the agent actually has,
 * so the assembled prompt matches the agent's real capabilities (issue #3136).
 */
export function extractDeclaredToolNames(
  tools: ToolConfig['tools'] | undefined,
): string[] {
  if (!tools) {
    return [];
  }
  const names: string[] = [];
  for (const toolRef of tools) {
    if (typeof toolRef === 'string') {
      names.push(toolRef);
    } else if ('schema' in toolRef) {
      const schemaName = toolRef.schema.name;
      if (typeof schemaName === 'string' && schemaName.length > 0) {
        names.push(schemaName);
      }
    } else if (typeof toolRef.name === 'string') {
      names.push(toolRef.name);
    }
  }
  return names;
}

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
 *
 * Substitutes `${input_name}` placeholders inside every `TextBlock` within
 * each `IContent` message. Non-text blocks are passed through unchanged.
 */
export function applyTemplateToInitialMessages(
  initialMessages: IContent[],
  inputs: AgentInputs,
): IContent[] {
  return initialMessages.map((content) => {
    const newBlocks = content.blocks.map((block) => {
      if (block.type === 'text') {
        const textBlock: TextBlock = {
          ...block,
          text: templateString(block.text, inputs),
        };
        return textBlock;
      }
      return block;
    });
    return { ...content, blocks: newBlocks };
  });
}
