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
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import type {
  PromptContext,
  PromptEnvironment,
} from '../prompt-config/types.js';

// Singleton instance of PromptService
let promptService: PromptService | null = null;
let promptServiceInitialized = false;
let promptServiceInitPromise: Promise<void> | null = null;

/**
 * Initialize the PromptService singleton
 */
async function initializePromptService(): Promise<void> {
  if (!promptServiceInitPromise) {
    promptServiceInitPromise = (async () => {
      const baseDir =
        process.env.LLXPRT_PROMPTS_DIR ||
        path.join(os.homedir(), '.llxprt', 'prompts');
      promptService = new PromptService({
        baseDir,
        debugMode: process.env.DEBUG === 'true',
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

export async function drainPromptInstallerNotices(): Promise<string[]> {
  const service = await getPromptService();
  return service.consumeInstallerNotices();
}

/**
 * Get tool name mapping - lazy initialization to avoid circular dependencies
 */
function getToolNameMapping(): Record<string, string> {
  return {
    list_directory: 'Ls',
    replace: 'Edit',
    glob: 'Glob',
    search_file_content: 'Grep',
    read_file: 'ReadFile',
    read_many_files: 'ReadManyFiles',
    run_shell_command: 'Shell',
    write_file: 'WriteFile',
    memory: 'Memory',
    todo_read: 'TodoRead',
    todo_write: 'TodoWrite',
    web_fetch: 'WebFetch',
    google_web_search: 'WebSearch',
    delete_line_range: 'DeleteLineRange',
    insert_at_line: 'InsertAtLine',
    read_line_range: 'ReadLineRange',
  };
}

/**
 * Build PromptContext from current environment and parameters
 */
async function buildPromptContext(
  model?: string,
  tools?: string[],
  provider?: string,
): Promise<PromptContext> {
  const cwd = process.cwd();

  // Generate folder structure for the current working directory
  let folderStructure: string | undefined;
  try {
    folderStructure = await getFolderStructure(cwd, {
      maxItems: 100, // Limit for startup performance
    });
  } catch (error) {
    // If folder structure generation fails, continue without it
    console.warn('Failed to generate folder structure:', error);
  }

  const workspaceDirectories = [cwd];

  const environment: PromptEnvironment = {
    isGitRepository: isGitRepository(cwd),
    isSandboxed: !!process.env.SANDBOX,
    hasIdeCompanion: false,
    workingDirectory: cwd,
    workspaceRoot: cwd,
    workspaceName: path.basename(cwd),
    workspaceDirectories,
    folderStructure,
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
  let enabledTools: string[];
  if (tools === undefined) {
    enabledTools = [
      'Ls',
      'Edit',
      'Glob',
      'Grep',
      'ReadFile',
      'ReadManyFiles',
      'Shell',
      'WriteFile',
      'Memory',
      'TodoRead',
      'TodoWrite',
      'WebFetch',
      'WebSearch',
      'delete_line_range',
      'insert_at_line',
      'read_line_range',
    ];
  } else if (tools.length > 0) {
    const mappedTools = tools
      .map((toolName) => {
        // First try direct mapping (handles existing snake_case tools)
        if (toolMapping[toolName]) {
          return toolMapping[toolName];
        }
        // Try mapping kebab-case versions (for new tools)
        const snakeName = toolName.replace(/-/g, '_');
        if (toolMapping[snakeName]) {
          return toolMapping[snakeName];
        }
        // If no mapping, it might already be in the right format
        return toolName;
      })
      .filter(Boolean);
    enabledTools = Array.from(new Set(mappedTools));
  } else {
    enabledTools = [];
  }

  // Use provider if explicitly passed, otherwise get from settings or default to gemini
  let resolvedProvider = provider || 'gemini';

  // If provider wasn't explicitly passed, try to get it from settings
  if (!provider) {
    try {
      const settingsService = getSettingsService();
      const activeProvider = settingsService.get('activeProvider') as string;
      if (activeProvider) {
        resolvedProvider = activeProvider;
      }
    } catch (_error) {
      // If we can't get settings (e.g., during tests), use default
      // Don't log in production to avoid noise
    }
  }

  return {
    provider: resolvedProvider,
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
  tools?: string[],
): Promise<string> {
  const service = await getPromptService();
  const context = await buildPromptContext(model, tools);
  return await service.getPrompt(context, userMemory);
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

After your reasoning is complete, generate the final <state_snapshot> XML object. Be incredibly dense with information. Omit any irrelevant conversational filler. Ensure you preserve enough context that the agent can continue its work seamlessly.

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
         - Authentication: Uses Firebase Auth, API keys stored in \`config/keys.json\`
        -->
    </key_knowledge>

    <current_progress>
        <!-- What has been accomplished so far? Use bullet points. -->
        <!-- Example:
         - Created new authentication middleware in \`src/auth/middleware.ts\`
         - Updated user registration endpoint to use new JWT library
         - Started refactoring login endpoint but encountered TypeScript errors
        -->
    </current_progress>

    <active_tasks>
        <!-- What specific tasks need to be completed next? Use bullet points. -->
        <!-- Example:
         - Fix TypeScript errors in \`src/auth/login.ts\`
         - Update unit tests for authentication middleware
         - Remove deprecated auth helper functions
        -->
    </active_tasks>

    <open_questions>
        <!-- Any unresolved issues, errors, or questions that need attention? Use bullet points. -->
        <!-- Example:
         - Need to decide if old JWT tokens should be invalidated immediately
         - Database migration for user table might be needed
        -->
    </open_questions>
</state_snapshot>
`.trim();
}
