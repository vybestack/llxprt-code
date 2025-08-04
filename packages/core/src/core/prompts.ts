/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { isGitRepository } from '../utils/gitUtils.js';
import { PromptService } from '../prompt-config/prompt-service.js';
import type { PromptContext, PromptEnvironment } from '../prompt-config/types.js';
import { CORE_DEFAULTS } from '../prompt-config/defaults/core-defaults.js';

// Singleton instance of PromptService
let promptService: PromptService | null = null;
let promptServiceInitialized = false;
let promptServiceInitPromise: Promise<void> | null = null;

/**
 * Reset the prompt service singleton (for testing)
 */
export function resetPromptService(): void {
  promptService = null;
  promptServiceInitialized = false;
  promptServiceInitPromise = null;
}

/**
 * Initialize the PromptService singleton
 */
async function initializePromptService(): Promise<void> {
  if (!promptServiceInitPromise) {
    promptServiceInitPromise = (async () => {
      const baseDir = process.env.LLXPRT_PROMPTS_DIR || 
                      path.join(os.homedir(), '.llxprt', 'prompts');
      promptService = new PromptService({ 
        baseDir,
        debugMode: process.env.DEBUG === 'true'
      });
      await promptService.initialize();
      promptServiceInitialized = true;
    })();
  }
  return promptServiceInitPromise;
}

/**
 * Get the singleton PromptService instance (async)
 */
async function getPromptService(): Promise<PromptService> {
  if (!promptServiceInitialized) {
    await initializePromptService();
  }
  return promptService!;
}


/**
 * Get tool name mapping - lazy initialization to avoid circular dependencies
 */
function getToolNameMapping(): Record<string, string> {
  return {
    'list_directory': 'Ls',
    'replace': 'Edit',
    'glob': 'Glob',
    'search_file_content': 'Grep',
    'read_file': 'ReadFile',
    'read_many_files': 'ReadManyFiles',
    'run_shell_command': 'Shell',
    'write_file': 'WriteFile',
    'memory': 'Memory',
    'todo_read': 'TodoRead',
    'todo_write': 'TodoWrite',
    'web_fetch': 'WebFetch',
    'google_web_search': 'WebSearch',
  };
}

/**
 * Build PromptContext from current environment and parameters
 */
function buildPromptContext(model?: string, tools?: string[]): PromptContext {
  const environment: PromptEnvironment = {
    isGitRepository: isGitRepository(process.cwd()),
    isSandboxed: !!process.env.SANDBOX,
    hasIdeCompanion: false,
  };

  // Determine sandbox type
  if (process.env.SANDBOX === 'sandbox-exec') {
    environment.sandboxType = 'macos-seatbelt';
  } else if (process.env.SANDBOX) {
    environment.sandboxType = 'generic';
  }
  

  // Add other environment flags
  if (process.env.IDE_COMPANION === 'true') {
    environment.hasIdeCompanion = true;
  }

  // Map tools to PascalCase names
  const toolMapping = getToolNameMapping();
  const enabledTools = tools?.map(toolName => 
    toolMapping[toolName] || toolName
  ) || [];

  // Default to all core tools if none specified
  if (enabledTools.length === 0) {
    enabledTools.push(
      'Ls', 'Edit', 'Glob', 'Grep', 'ReadFile', 
      'ReadManyFiles', 'Shell', 'WriteFile', 'Memory',
      'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'
    );
  }

  return {
    provider: 'gemini', // Default provider for now
    model: model || 'gemini-1.5-pro',
    enabledTools,
    environment,
  };
}

/**
 * Async version of getCoreSystemPrompt that uses the new PromptService
 */
export async function getCoreSystemPromptAsync(
  userMemory?: string,
  model?: string,
  tools?: string[]
): Promise<string> {
  const service = await getPromptService();
  const context = buildPromptContext(model, tools);
  return await service.getPrompt(context, userMemory);
}

export function getCoreSystemPrompt(
  userMemory?: string,
  _model?: string,
  _tools?: string[]
): string {
  // This synchronous version is deprecated and should not be used
  // It exists only for backward compatibility during migration
  console.warn('getCoreSystemPrompt: Synchronous version is deprecated. Use getCoreSystemPromptAsync instead.');
  
  // Initialize async service in background for future calls
  initializePromptSystem().catch(error => {
    console.error('Failed to initialize prompt system:', error);
  });

  // Return the core prompt from defaults as a fallback for backward compatibility
  let prompt = CORE_DEFAULTS['core.md'] || 'System prompt not available';
  
  // Add environment-specific content for basic compatibility
  const environment = {
    isGitRepository: isGitRepository(process.cwd()),
    isSandboxed: !!process.env.SANDBOX,
  };

  if (environment.isGitRepository) {
    prompt += '\n\n' + (CORE_DEFAULTS['env/git-repository.md'] || '');
  }

  if (environment.isSandboxed) {
    if (process.env.SANDBOX === 'sandbox-exec') {
      prompt += '\n\n' + (CORE_DEFAULTS['env/macos-seatbelt.md'] || '');
    } else {
      prompt += '\n\n' + (CORE_DEFAULTS['env/sandbox.md'] || '');
    }
  } else {
    prompt += '\n\n' + (CORE_DEFAULTS['env/outside-of-sandbox.md'] || '');
  }

  // Append user memory if provided
  if (userMemory && userMemory.trim()) {
    prompt += `\n\n---\n\n${userMemory.trim()}`;
  }

  return prompt;
}

/**
 * Initialize the prompt system - call this early in application startup
 */
export async function initializePromptSystem(): Promise<void> {
  await initializePromptService();
}

/**
 * Provides the system prompt for the history compression process.
 * This prompt instructs the model to act as a specialized state manager,
 * think in a scratchpad, and produce a structured XML summary.
 */
export function getCompressionPrompt(): string {
  return `
You are the component that summarizes internal chat history into a given structure.

When the conversation history grows too large, you will be invoked to distill the entire history into a concise, structured XML snapshot. This snapshot is CRITICAL, as it will become the agent's *only* memory of the past. The agent will resume its work based solely on this snapshot. All crucial details, plans, errors, and user directives MUST be preserved.

First, you will think through the entire history in a private <scratchpad>. Review the user's overall goal, the agent's actions, tool outputs, file modifications, and any unresolved questions. Identify every piece of information that is essential for future actions.

After your reasoning is complete, generate the final <state_snapshot> XML object. Be incredibly dense with information. Omit any irrelevant conversational filler.

The structure MUST be as follows:

<state_snapshot>
    <overall_goal>
        <!-- A single, concise sentence describing the user's high-level objective. -->
        <!-- Example: "Refactor the authentication service to use a new JWT library." -->
    </overall_goal>

    <key_knowledge>
        <!-- Crucial facts, conventions, and constraints the agent must remember based on the conversation history and interaction with the user. Use bullet points. -->
        <!-- Example:
         - Build Command: \`npm run build\`
         - Testing: Tests are run with \`npm test\`. Test files must end in \`.test.ts\`.
         - API Endpoint: The primary API endpoint is \`https://api.example.com/v2\`.
         
        -->
    </key_knowledge>

    <file_system_state>
        <!-- List files that have been created, read, modified, or deleted. Note their status and critical learnings. -->
        <!-- Example:
         - CWD: \`/home/user/project/src\`
         - READ: \`package.json\` - Confirmed 'axios' is a dependency.
         - MODIFIED: \`services/auth.ts\` - Replaced 'jsonwebtoken' with 'jose'.
         - CREATED: \`tests/new-feature.test.ts\` - Initial test structure for the new feature.
        -->
    </file_system_state>

    <recent_actions>
        <!-- A summary of the last few significant agent actions and their outcomes. Focus on facts. -->
        <!-- Example:
         - Ran \`grep 'old_function'\` which returned 3 results in 2 files.
         - Ran \`npm run test\`, which failed due to a snapshot mismatch in \`UserProfile.test.ts\`.
         - Ran \`ls -F static/\` and discovered image assets are stored as \`.webp\`.
        -->
    </recent_actions>

    <current_plan>
        <!-- The agent's step-by-step plan. Mark completed steps. -->
        <!-- Example:
         1. [DONE] Identify all files using the deprecated 'UserAPI'.
         2. [IN PROGRESS] Refactor \`src/components/UserProfile.tsx\` to use the new 'ProfileAPI'.
         3. [TODO] Refactor the remaining files.
         4. [TODO] Update tests to reflect the API change.
        -->
    </current_plan>
</state_snapshot>
`.trim();
}