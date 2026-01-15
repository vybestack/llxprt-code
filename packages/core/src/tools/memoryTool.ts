/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolEditConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolResult,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { type FunctionDeclaration } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Storage } from '../config/storage.js';
import * as Diff from 'diff';
import { DEFAULT_CREATE_PATCH_OPTIONS } from './diffOptions.js';
import { tildeifyPath } from '../utils/paths.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { ToolErrorType } from './tool-error.js';
import { DebugLogger } from '../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:tools:memory');

const memoryToolSchemaData: FunctionDeclaration = {
  name: 'save_memory',
  description:
    'Saves a specific piece of information or fact to your long-term memory. Use this when the user explicitly asks you to remember something, or when they state a clear, concise fact that seems important to retain for future interactions.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description:
          'The specific fact or piece of information to remember. Should be a clear, self-contained statement.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description:
          'Where to save the memory: "global" or "project" (default, saves to project-local .llxprt directory)',
        default: 'project',
      },
    },
    required: ['fact'],
  },
};

const memoryToolDescription = `
Saves a specific piece of information or fact to your long-term memory.

Use this tool:

- When the user explicitly asks you to remember something (e.g., "Remember that I like pineapple on pizza", "Please save this: my cat's name is Whiskers").
- When the user states a clear, concise fact about themselves, their preferences, or their environment that seems important for you to retain for future interactions to provide a more personalized and effective assistance.

Do NOT use this tool:

- To remember conversational context that is only relevant for the current session.
- To save long, complex, or rambling pieces of text. The fact should be relatively short and to the point.
- If you are unsure whether the information is a fact worth remembering long-term. If in doubt, you can ask the user, "Should I remember that for you?"

## Parameters

- \`fact\` (string, required): The specific fact or piece of information to remember. This should be a clear, self-contained statement. For example, if the user says "My favorite color is blue", the fact would be "My favorite color is blue".
`;

export const LLXPRT_CONFIG_DIR = '.llxprt';
// Alias for backward compatibility with gemini-cli code
export const GEMINI_DIR = LLXPRT_CONFIG_DIR;
export const DEFAULT_CONTEXT_FILENAME = 'LLXPRT.md';
export const MEMORY_SECTION_HEADER = '## LLxprt Code Added Memories';

// This variable will hold the currently configured filename for LLXPRT.md context files.
// It defaults to DEFAULT_CONTEXT_FILENAME but can be overridden by setLlxprtMdFilename.
let currentLlxprtMdFilename: string | string[] = DEFAULT_CONTEXT_FILENAME;

export function setLlxprtMdFilename(newFilename: string | string[]): void {
  if (Array.isArray(newFilename)) {
    if (newFilename.length > 0) {
      currentLlxprtMdFilename = newFilename.map((name) => name.trim());
    }
  } else if (newFilename && newFilename.trim() !== '') {
    currentLlxprtMdFilename = newFilename.trim();
  }
}

export function getCurrentLlxprtMdFilename(): string {
  if (Array.isArray(currentLlxprtMdFilename)) {
    return currentLlxprtMdFilename[0];
  }
  return currentLlxprtMdFilename;
}

export function getAllLlxprtMdFilenames(): string[] {
  if (Array.isArray(currentLlxprtMdFilename)) {
    return currentLlxprtMdFilename;
  }
  return [currentLlxprtMdFilename];
}

interface SaveMemoryParams {
  fact: string;
  scope?: 'global' | 'project';
  modified_by_user?: boolean;
  modified_content?: string;
}

function getGlobalMemoryFilePath(): string {
  return path.join(Storage.getGlobalLlxprtDir(), getCurrentLlxprtMdFilename());
}

function getProjectMemoryFilePath(workingDir: string): string {
  return path.join(workingDir, LLXPRT_CONFIG_DIR, getCurrentLlxprtMdFilename());
}

/**
 * Ensures proper newline separation before appending content.
 */
function ensureNewlineSeparation(currentContent: string): string {
  if (currentContent.length === 0) return '';
  if (currentContent.endsWith('\n\n') || currentContent.endsWith('\r\n\r\n'))
    return '';
  if (currentContent.endsWith('\n') || currentContent.endsWith('\r\n'))
    return '\n';
  return '\n\n';
}

/**
 * Computes the new content that would result from adding a memory entry
 */
function computeNewContent(currentContent: string, fact: string): string {
  let processedText = fact.trim();
  processedText = processedText.replace(/^(-+\s*)+/, '').trim();
  const newMemoryItem = `- ${processedText}`;

  const headerIndex = currentContent.indexOf(MEMORY_SECTION_HEADER);

  if (headerIndex === -1) {
    // Header not found, append header and then the entry
    const separator = ensureNewlineSeparation(currentContent);
    return (
      currentContent +
      `${separator}${MEMORY_SECTION_HEADER}\n${newMemoryItem}\n`
    );
  } else {
    // Header found, find where to insert the new memory entry
    const startOfSectionContent = headerIndex + MEMORY_SECTION_HEADER.length;
    let endOfSectionIndex = currentContent.indexOf(
      '\n## ',
      startOfSectionContent,
    );
    if (endOfSectionIndex === -1) {
      endOfSectionIndex = currentContent.length; // End of file
    }

    const beforeSectionMarker = currentContent
      .substring(0, startOfSectionContent)
      .trimEnd();
    let sectionContent = currentContent
      .substring(startOfSectionContent, endOfSectionIndex)
      .trimEnd();
    const afterSectionMarker = currentContent.substring(endOfSectionIndex);

    sectionContent += `\n${newMemoryItem}`;
    return (
      `${beforeSectionMarker}\n${sectionContent.trimStart()}\n${afterSectionMarker}`.trimEnd() +
      '\n'
    );
  }
}

class MemoryToolInvocation extends BaseToolInvocation<
  SaveMemoryParams,
  ToolResult
> {
  private static readonly allowlist: Set<string> = new Set();
  private workingDir?: string;

  constructor(params: SaveMemoryParams, messageBus?: MessageBus) {
    super(params, messageBus);
  }

  setWorkingDir(workingDir: string): void {
    this.workingDir = workingDir;
  }

  getMemoryFilePath(): string {
    const scope = this.params.scope || 'project';
    if (scope === 'project' && this.workingDir) {
      return getProjectMemoryFilePath(this.workingDir);
    }
    return getGlobalMemoryFilePath();
  }

  async readMemoryFileContent(): Promise<string> {
    try {
      return await fs.readFile(this.getMemoryFilePath(), 'utf-8');
    } catch (err) {
      const error = err as Error & { code?: string };
      if (!(error instanceof Error) || error.code !== 'ENOENT') throw err;
      return '';
    }
  }

  override getToolName(): string {
    return MemoryTool.Name;
  }

  override getDescription(): string {
    const memoryFilePath = this.getMemoryFilePath();
    return `in ${tildeifyPath(memoryFilePath)}`;
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolEditConfirmationDetails | false> {
    const memoryFilePath = this.getMemoryFilePath();
    const allowlistKey = memoryFilePath;

    if (MemoryToolInvocation.allowlist.has(allowlistKey)) {
      return false;
    }

    const currentContent = await this.readMemoryFileContent();
    const newContent = computeNewContent(currentContent, this.params.fact);

    const fileName = path.basename(memoryFilePath);
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    ) as string;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Memory Save: ${tildeifyPath(memoryFilePath)}`,
      fileName: memoryFilePath,
      filePath: memoryFilePath,
      fileDiff,
      originalContent: currentContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          MemoryToolInvocation.allowlist.add(allowlistKey);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { fact, modified_by_user, modified_content } = this.params;
    const memoryFilePath = this.getMemoryFilePath();

    try {
      if (modified_by_user && modified_content !== undefined) {
        // User modified the content in external editor, write it directly
        await fs.mkdir(path.dirname(memoryFilePath), {
          recursive: true,
        });
        await fs.writeFile(memoryFilePath, modified_content, 'utf-8');
        const successMessage = `Okay, I've updated the memory file with your modifications.`;
        return {
          llmContent: JSON.stringify({
            success: true,
            message: successMessage,
          }),
          returnDisplay: successMessage,
        };
      } else {
        // Use the normal memory entry logic
        await MemoryTool.performAddMemoryEntry(fact, memoryFilePath, {
          readFile: fs.readFile,
          writeFile: fs.writeFile,
          mkdir: fs.mkdir,
        });
        const successMessage = `Okay, I've remembered that: "${fact}"`;
        return {
          llmContent: JSON.stringify({
            success: true,
            message: successMessage,
          }),
          returnDisplay: successMessage,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Error executing save_memory for fact "${fact}": ${errorMessage}`,
      );
      return {
        llmContent: JSON.stringify({
          success: false,
          error: `Failed to save memory. Detail: ${errorMessage}`,
        }),
        returnDisplay: `Error saving memory: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.MEMORY_TOOL_EXECUTION_ERROR,
        },
      };
    }
  }
}

export class MemoryTool
  extends BaseDeclarativeTool<SaveMemoryParams, ToolResult>
  implements ModifiableDeclarativeTool<SaveMemoryParams>
{
  static readonly Name: string = memoryToolSchemaData.name!;
  constructor(
    private config?: { getWorkingDir: () => string },
    messageBus?: MessageBus,
  ) {
    super(
      MemoryTool.Name,
      'Save Memory',
      memoryToolDescription,
      Kind.Think,
      memoryToolSchemaData.parametersJsonSchema as Record<string, unknown>,
      false, // output is not markdown
      false, // output cannot be updated
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: SaveMemoryParams,
  ): string | null {
    if (params.fact.trim() === '') {
      return 'Parameter "fact" must be a non-empty string.';
    }

    return null;
  }

  protected createInvocation(
    params: SaveMemoryParams,
    messageBus?: MessageBus,
  ) {
    const invocation = new MemoryToolInvocation(params, messageBus);
    if (this.config) {
      invocation.setWorkingDir(this.config.getWorkingDir());
    }
    return invocation;
  }

  static async performAddMemoryEntry(
    text: string,
    memoryFilePath: string,
    fsAdapter: {
      readFile: (path: string, encoding: 'utf-8') => Promise<string>;
      writeFile: (
        path: string,
        data: string,
        encoding: 'utf-8',
      ) => Promise<void>;
      mkdir: (
        path: string,
        options: { recursive: boolean },
      ) => Promise<string | undefined>;
    },
  ): Promise<void> {
    try {
      await fsAdapter.mkdir(path.dirname(memoryFilePath), { recursive: true });
      let currentContent = '';
      try {
        currentContent = await fsAdapter.readFile(memoryFilePath, 'utf-8');
      } catch (_e) {
        // File doesn't exist, which is fine. currentContent will be empty.
      }

      const newContent = computeNewContent(currentContent, text);

      await fsAdapter.writeFile(memoryFilePath, newContent, 'utf-8');
    } catch (error) {
      logger.error(
        `Error adding memory entry to ${memoryFilePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(
        `[MemoryTool] Failed to add memory entry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getModifyContext(_abortSignal: AbortSignal): ModifyContext<SaveMemoryParams> {
    const resolvePath = (scope?: 'global' | 'project'): string => {
      const resolvedScope = scope || 'project';
      if (resolvedScope === 'project' && this.config) {
        return getProjectMemoryFilePath(this.config.getWorkingDir());
      }
      return getGlobalMemoryFilePath();
    };

    return {
      getFilePath: (params: SaveMemoryParams) => resolvePath(params.scope),
      getCurrentContent: async (params: SaveMemoryParams): Promise<string> => {
        const memoryFilePath = resolvePath(params.scope);
        try {
          return await fs.readFile(memoryFilePath, 'utf-8');
        } catch (err) {
          const error = err as Error & { code?: string };
          if (!(error instanceof Error) || error.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: SaveMemoryParams): Promise<string> => {
        const memoryFilePath = resolvePath(params.scope);
        try {
          const currentContent = await fs.readFile(memoryFilePath, 'utf-8');
          return computeNewContent(currentContent, params.fact);
        } catch (err) {
          const error = err as Error & { code?: string };
          if (!(error instanceof Error) || error.code !== 'ENOENT') throw err;
          return computeNewContent('', params.fact);
        }
      },
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        originalParams: SaveMemoryParams,
      ): SaveMemoryParams => ({
        ...originalParams,
        modified_by_user: true,
        modified_content: modifiedProposedContent,
      }),
    };
  }
}
