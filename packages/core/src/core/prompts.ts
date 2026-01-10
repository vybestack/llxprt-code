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
import { DebugLogger } from '../debug/index.js';
import type {
  PromptContext,
  PromptEnvironment,
} from '../prompt-config/types.js';

const MAX_FOLDER_STRUCTURE_LINES = 40;
const MAX_FOLDER_STRUCTURE_CHARS = 6000;
const MAX_FOLDER_STRUCTURE_TOP_LEVEL = 20;
const SESSION_STARTED_AT = new Date();
const SESSION_STARTED_AT_LABEL = SESSION_STARTED_AT.toLocaleString();
const logger = new DebugLogger('llxprt:core:prompts');

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
    google_web_fetch: 'GoogleWebFetch',
    direct_web_fetch: 'DirectWebFetch',
    google_web_search: 'GoogleWebSearch',
    exa_web_search: 'ExaWebSearch',
    codesearch: 'CodeSearch',
    delete_line_range: 'DeleteLineRange',
    insert_at_line: 'InsertAtLine',
    read_line_range: 'ReadLineRange',
    list_subagents: 'ListSubagents',
    task: 'Task',
  };
}

function extractFolderStructureHeader(lines: string[]): {
  header: string[];
  body: string[];
} {
  if (lines.length === 0) {
    return { header: [], body: [] };
  }

  const header: string[] = [];
  let index = 0;

  header.push(lines[index++] ?? '');

  if (index < lines.length && lines[index].trim() === '') {
    header.push(lines[index++]);
  }

  if (index < lines.length) {
    header.push(lines[index++]);
  }

  return { header, body: lines.slice(index) };
}

function compactFolderStructureSnapshot(
  structure?: string,
): string | undefined {
  if (!structure) {
    return structure;
  }

  const normalized = structure.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return undefined;
  }

  const lines = normalized.split('\n');
  if (
    lines.length <= MAX_FOLDER_STRUCTURE_LINES &&
    normalized.length <= MAX_FOLDER_STRUCTURE_CHARS
  ) {
    return normalized;
  }

  const { header, body } = extractFolderStructureHeader(lines);
  if (body.length === 0) {
    return normalized.slice(0, MAX_FOLDER_STRUCTURE_CHARS);
  }

  const topLevelEntries = body.filter(
    (line) => line.startsWith('├───') || line.startsWith('└───'),
  );
  const candidateLines = topLevelEntries.length > 0 ? topLevelEntries : body;
  const limitedLines = candidateLines.slice(0, MAX_FOLDER_STRUCTURE_TOP_LEVEL);
  const omittedCount = Math.max(candidateLines.length - limitedLines.length, 0);

  const truncatedLine = `└───... ${omittedCount} more entries omitted (folder structure truncated for provider limits)`;
  const snapshotLines = [...header, ...limitedLines, truncatedLine];

  let snapshot = snapshotLines.join('\n');
  if (snapshot.length > MAX_FOLDER_STRUCTURE_CHARS) {
    const allowance = Math.max(
      MAX_FOLDER_STRUCTURE_CHARS - truncatedLine.length - 1,
      0,
    );
    const preserved = snapshotLines
      .slice(0, snapshotLines.length - 1)
      .join('\n')
      .slice(0, allowance);
    snapshot = preserved ? `${preserved}\n${truncatedLine}` : truncatedLine;
  }

  return snapshot;
}

/**
 * Options for getCoreSystemPromptAsync
 */
export interface CoreSystemPromptOptions {
  userMemory?: string;
  model?: string;
  tools?: string[];
  provider?: string;
  includeSubagentDelegation?: boolean;
}

/**
 * Build PromptContext from current environment and parameters
 */
async function buildPromptContext(
  options: CoreSystemPromptOptions,
): Promise<PromptContext> {
  const { model, tools, provider, includeSubagentDelegation } = options;
  const cwd = process.cwd();

  // Check if folder structure should be included (default: false for better cache hit rates)
  let includeFolderStructure = false;
  let enableToolPrompts = false;
  try {
    const settingsService = getSettingsService();
    const folderStructureSetting = settingsService.get(
      'include-folder-structure',
    ) as boolean | undefined;
    if (folderStructureSetting !== undefined) {
      includeFolderStructure = folderStructureSetting;
    }
    const toolPromptsSetting = settingsService.get('enable-tool-prompts') as
      | boolean
      | undefined;
    if (toolPromptsSetting !== undefined) {
      enableToolPrompts = toolPromptsSetting;
    }
  } catch (_error) {
    // If we can't get settings, use default
  }

  // Generate folder structure for the current working directory
  let folderStructure: string | undefined;
  if (includeFolderStructure) {
    try {
      folderStructure = await getFolderStructure(cwd, {
        maxItems: 100, // Limit for startup performance
      });
      folderStructure = compactFolderStructureSnapshot(folderStructure);
    } catch (error) {
      // If folder structure generation fails, continue without it
      logger.debug(() => `Failed to generate folder structure: ${error}`);
    }
  }

  const workspaceDirectories = [cwd];

  const environment: PromptEnvironment = {
    isGitRepository: isGitRepository(cwd),
    isSandboxed: !!process.env.SANDBOX,
    hasIdeCompanion: false,
    sessionStartedAt: SESSION_STARTED_AT_LABEL,
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
      'GoogleWebFetch',
      'DirectWebFetch',
      'GoogleWebSearch',
      'ExaWebSearch',
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
    enableToolPrompts,
    includeSubagentDelegation,
  };
}

/**
 * Async version of getCoreSystemPrompt that uses the new PromptService
 * Supports both legacy positional arguments and options object for backward compatibility
 */
export async function getCoreSystemPromptAsync(
  userMemoryOrOptions?: string | CoreSystemPromptOptions,
  model?: string,
  tools?: string[],
): Promise<string> {
  const service = await getPromptService();

  // Handle both legacy positional args and options object
  let userMemory: string | undefined = undefined;
  let modelArg: string | undefined = undefined;
  let toolsArg: string[] | undefined = undefined;
  let providerArg: string | undefined = undefined;
  let includeSubagentDelegation: boolean | undefined = undefined;

  if (typeof userMemoryOrOptions === 'object' && userMemoryOrOptions !== null) {
    // Options object mode
    const opts = userMemoryOrOptions as CoreSystemPromptOptions;
    userMemory = opts.userMemory;
    modelArg = opts.model;
    toolsArg = opts.tools;
    providerArg = opts.provider;
    includeSubagentDelegation = opts.includeSubagentDelegation;
  } else {
    // Legacy positional args mode
    userMemory = userMemoryOrOptions as string | undefined;
    modelArg = model;
    toolsArg = tools;
  }

  const context = await buildPromptContext({
    model: modelArg,
    tools: toolsArg,
    provider: providerArg,
    includeSubagentDelegation,
  });

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

When the conversation history grows too large, you will be invoked to compress the MIDDLE portion of the history into a structured XML snapshot, reducing it by approximately 50%. This snapshot will be combined with preserved messages from the top and bottom of the conversation. The agent will have access to the full context: summary + preserved top messages + preserved bottom messages.

First, you will think through the middle portion of history in a private <scratchpad>. Review the user's overall goal, the agent's actions, tool outputs, file modifications, and any unresolved questions. Identify the most important information to preserve. Remember: user prompts and their exact phrasing are especially important to retain.

After your reasoning is complete, generate the final <state_snapshot> XML object. Be thorough but concise. Focus on preserving essential context while eliminating redundancy. Ensure the agent has sufficient information to continue work effectively.

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
