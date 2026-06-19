/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';

/**
 * Builds the system prompt from options, tools, and model ID, including
 * user memory, MCP instructions, and subagent delegation.
 */
export async function buildSystemPrompt(
  options: NormalizedGenerateChatOptions,
  tools: NormalizedGenerateChatOptions['tools'],
  modelId: string,
): Promise<string> {
  const flattenedToolNames =
    tools?.flatMap((group) =>
      group.functionDeclarations
        .map((decl) => decl.name)
        .filter((name): name is string => !!name),
    ) ?? [];
  const toolNamesArg =
    tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation.userMemory,
  );
  const config = options.config;
  const mcpInstructions =
    typeof config?.getMcpClientManager === 'function'
      ? config.getMcpClientManager()?.getMcpInstructions()
      : undefined;
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNamesArg ?? [],
    () =>
      typeof config?.getSubagentManager === 'function'
        ? config.getSubagentManager()
        : undefined,
  );
  const isInteractive = config?.isInteractive;
  return getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model: modelId,
    tools: toolNamesArg,
    includeSubagentDelegation,
    interactionMode:
      config &&
      typeof isInteractive === 'function' &&
      isInteractive.call(config) === true
        ? 'interactive'
        : 'non-interactive',
  });
}
