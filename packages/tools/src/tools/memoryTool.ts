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
import type { FunctionDeclaration } from '@google/genai';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import * as Diff from 'diff';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../utils/diffOptions.js';
import type {
  ISettingsService,
  IStorageService,
  IToolMessageBus,
} from '../interfaces/index.js';
import { shortenPath } from '../utils/paths.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { ToolErrorType } from '../types/tool-error.js';
import { debugLogger as logger } from '../utils/debugLogger.js';

function tildeifyPath(filePath: string): string {
  const homeDir = os.homedir();
  if (
    homeDir &&
    (filePath === homeDir || filePath.startsWith(`${homeDir}${path.sep}`))
  ) {
    return `~${filePath.slice(homeDir.length)}`;
  }
  return shortenPath(filePath);
}

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
        enum: ['global', 'project', 'core.global', 'core.project'],
        description:
          'Where to save the memory: "global" or "project" (default, saves to project-local .llxprt directory). ' +
          '"core.global" and "core.project" save to the system prompt (.LLXPRT_SYSTEM) — requires model.canSaveCore to be enabled.',
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
- \`scope\` (string, optional): Where to save the memory. Defaults to "project".
  - \`"global"\` — saved to the global LLXPRT.md file.
  - \`"project"\` — saved to the project-local .llxprt/LLXPRT.md file.
  - \`"core.global"\` — saved to the global system prompt (.LLXPRT_SYSTEM). Requires \`model.canSaveCore\` to be enabled.
  - \`"core.project"\` — saved to the project system prompt (.LLXPRT_SYSTEM). Requires \`model.canSaveCore\` to be enabled.
`;

export const LLXPRT_CONFIG_DIR = '.llxprt';
// Alias for backward compatibility with gemini-cli code
export const GEMINI_DIR = LLXPRT_CONFIG_DIR;
export const DEFAULT_CONTEXT_FILENAME = 'LLXPRT.md';
export const CORE_MEMORY_FILENAME = '.LLXPRT_SYSTEM';
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

type MemoryScope = 'global' | 'project' | 'core.global' | 'core.project';

export interface SaveMemoryParams {
  fact?: string;
  content?: string;
  read?: boolean;
  scope?: MemoryScope;
  modified_by_user?: boolean;
  modified_content?: string;
}

function isCoreScope(scope?: MemoryScope): boolean {
  return scope === 'core.global' || scope === 'core.project';
}

function getDefaultGlobalLlxprtDir(): string {
  const homeDir = os.homedir();
  if (!homeDir) {
    return path.join(os.tmpdir(), LLXPRT_CONFIG_DIR);
  }
  return path.join(homeDir, LLXPRT_CONFIG_DIR);
}

function getGlobalMemoryFilePath(storageService: IStorageService): string {
  return path.join(storageService.getLLXPRTDir(), getCurrentLlxprtMdFilename());
}

function getProjectMemoryFilePath(workingDir: string): string {
  return path.join(workingDir, LLXPRT_CONFIG_DIR, getCurrentLlxprtMdFilename());
}

export function getGlobalCoreMemoryFilePath(
  storageService?: Pick<IStorageService, 'getLLXPRTDir'>,
): string {
  return path.join(
    storageService?.getLLXPRTDir() ?? getDefaultGlobalLlxprtDir(),
    CORE_MEMORY_FILENAME,
  );
}

export function getProjectCoreMemoryFilePath(workingDir: string): string {
  return path.join(workingDir, LLXPRT_CONFIG_DIR, CORE_MEMORY_FILENAME);
}

export interface MemoryToolDependencies {
  storageService: IStorageService;
  settingsService?: Pick<ISettingsService, 'getSetting'>;
  getWorkingDir?: () => string;
  messageBus?: IToolMessageBus;
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
 * Strips leading dash groups and intervening whitespace using a safe linear
 * loop instead of a potentially-polynomial regex like /^(-+\s*)+/.
 */
function stripLeadingDashPrefixes(text: string): string {
  let i = 0;
  while (i < text.length) {
    // Skip a group of dashes
    let advanced = false;
    while (i < text.length && text[i] === '-') {
      i++;
      advanced = true;
    }
    // Skip following whitespace
    while (i < text.length && /\s/.test(text[i])) {
      i++;
      advanced = true;
    }
    if (!advanced) {
      break;
    }
  }
  return text.slice(i);
}

/**
 * Computes the new content that would result from adding a memory entry
 */
function computeNewContent(currentContent: string, fact: string): string {
  let processedText = fact.trim();
  processedText = stripLeadingDashPrefixes(processedText).trim();
  const newMemoryItem = `- ${processedText}`;

  const headerIndex = currentContent.indexOf(MEMORY_SECTION_HEADER);

  if (headerIndex === -1) {
    // Header not found, append header and then the entry
    const separator = ensureNewlineSeparation(currentContent);
    return (
      currentContent +
      `${separator}${MEMORY_SECTION_HEADER}\n${newMemoryItem}\n`
    );
  }
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

class MemoryToolInvocation extends BaseToolInvocation<
  SaveMemoryParams,
  ToolResult
> {
  private static readonly allowlist: Set<string> = new Set();

  constructor(
    params: SaveMemoryParams,
    messageBus: IToolMessageBus,
    private readonly storageService: IStorageService,
    private getWorkingDir?: () => string,
  ) {
    super(params, messageBus);
  }

  setWorkingDir(workingDir: string): void {
    this.getWorkingDir = () => workingDir;
  }

  private resolveWorkingDir(): string | undefined {
    return this.getWorkingDir?.();
  }

  getMemoryFilePath(): string {
    const scope = this.params.scope ?? 'project';
    const workingDir = this.resolveWorkingDir();
    switch (scope) {
      case 'core.project':
        return getProjectCoreMemoryFilePath(workingDir ?? process.cwd());
      case 'core.global':
        return getGlobalCoreMemoryFilePath(this.storageService);
      case 'project':
        if (workingDir) {
          return getProjectMemoryFilePath(workingDir);
        }
        return getGlobalMemoryFilePath(this.storageService);
      case 'global':
      default:
        return getGlobalMemoryFilePath(this.storageService);
    }
  }

  async readMemoryFileContent(): Promise<string> {
    try {
      return await this.storageService.readFile(this.getMemoryFilePath());
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
    const fact = this.params.fact ?? this.params.content ?? '';
    const newContent = computeNewContent(currentContent, fact);

    const fileName = path.basename(memoryFilePath);
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

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
        await this.publishPolicyUpdate(outcome);
      },
    };
    return confirmationDetails;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { modified_by_user, modified_content } = this.params;
    const fact = this.params.fact ?? this.params.content ?? '';
    if (this.params.read === true) {
      const content = await this.readMemoryFileContent();
      return {
        llmContent: content,
        returnDisplay: content,
      };
    }

    const memoryFilePath = this.getMemoryFilePath();

    try {
      if (modified_by_user === true && modified_content !== undefined) {
        // User modified the content in external editor, write it directly
        await this.storageService.ensureDir(path.dirname(memoryFilePath));
        await this.storageService.writeFile(memoryFilePath, modified_content);
        const successMessage = `Okay, I've updated the memory file with your modifications.`;
        return {
          llmContent: JSON.stringify({
            success: true,
            message: successMessage,
          }),
          returnDisplay: successMessage,
        };
      }
      // Use the normal memory entry logic
      await MemoryTool.performAddMemoryEntry(fact, memoryFilePath, {
        readFile: (filePath) => this.storageService.readFile(filePath),
        writeFile: (filePath, data) =>
          this.storageService.writeFile(filePath, data),
        mkdir: async (dirPath) => {
          await this.storageService.ensureDir(dirPath);
          return undefined;
        },
      });
      const successMessage = `Okay, I've remembered that: "${fact}"`;
      return {
        llmContent: JSON.stringify({
          success: true,
          message: successMessage,
        }),
        returnDisplay: successMessage,
      };
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

  private readonly storageService: IStorageService;
  private readonly settingsService?: Pick<ISettingsService, 'getSetting'>;
  private readonly getWorkingDir?: () => string;

  constructor(
    dependencies: MemoryToolDependencies | IStorageService = {
      storageService: {
        getLLXPRTDir: getDefaultGlobalLlxprtDir,
        readFile: (filePath) => fs.readFile(filePath, 'utf-8'),
        writeFile: (filePath, content) =>
          fs.writeFile(filePath, content, 'utf-8'),
        ensureDir: (dirPath) =>
          fs.mkdir(dirPath, { recursive: true }).then(() => undefined),
      },
    },
  ) {
    const resolvedDependencies =
      'storageService' in dependencies
        ? dependencies
        : { storageService: dependencies };
    super(
      MemoryTool.Name,
      'SaveMemory',
      memoryToolDescription,
      Kind.Think,
      memoryToolSchemaData.parametersJsonSchema as Record<string, unknown>,
      false, // output is not markdown
      false, // output cannot be updated
      resolvedDependencies.messageBus,
    );
    this.storageService = resolvedDependencies.storageService;
    this.settingsService = resolvedDependencies.settingsService;
    this.getWorkingDir = resolvedDependencies.getWorkingDir;
  }

  protected override validateToolParamValues(
    params: SaveMemoryParams,
  ): string | null {
    if (
      params.read !== true &&
      (params.fact ?? params.content ?? '').trim() === ''
    ) {
      return 'Parameter "fact" must be a non-empty string.';
    }

    // Core scopes require model.canSaveCore to be enabled
    if (isCoreScope(params.scope)) {
      try {
        const canSaveCore = this.settingsService?.getSetting(
          'model.canSaveCore',
        ) as boolean | undefined;
        if (canSaveCore !== true) {
          return (
            'Core memory scopes (core.global, core.project) are disabled. ' +
            'Enable them with: /set model.canSaveCore true\n' +
            'WARNING: This allows the model to modify your system directives.'
          );
        }
      } catch {
        return 'Core memory scopes require model.canSaveCore to be enabled.';
      }
    }

    return null;
  }

  protected createInvocation(
    params: SaveMemoryParams,
    messageBus: IToolMessageBus,
  ) {
    return new MemoryToolInvocation(
      params,
      messageBus,
      this.storageService,
      this.getWorkingDir,
    );
  }

  async execute(params: SaveMemoryParams): Promise<ToolResult> {
    const invocation = this.build({
      ...params,
      fact: params.fact ?? params.content ?? '',
    });
    return invocation.execute(new AbortController().signal);
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
      } catch {
        // File doesn't exist - currentContent remains empty
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
    const resolvePath = (scope?: MemoryScope): string => {
      const resolvedScope = scope ?? 'project';
      const workingDir = this.getWorkingDir?.();
      switch (resolvedScope) {
        case 'core.project':
          return getProjectCoreMemoryFilePath(workingDir ?? process.cwd());
        case 'core.global':
          return getGlobalCoreMemoryFilePath(this.storageService);
        case 'project':
          if (workingDir) {
            return getProjectMemoryFilePath(workingDir);
          }
          return getGlobalMemoryFilePath(this.storageService);
        case 'global':
        default:
          return getGlobalMemoryFilePath(this.storageService);
      }
    };

    return {
      getFilePath: (params: SaveMemoryParams) => resolvePath(params.scope),
      getCurrentContent: async (params: SaveMemoryParams): Promise<string> => {
        const memoryFilePath = resolvePath(params.scope);
        try {
          return await this.storageService.readFile(memoryFilePath);
        } catch (err) {
          const error = err as Error & { code?: string };
          if (!(error instanceof Error) || error.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: SaveMemoryParams): Promise<string> => {
        const memoryFilePath = resolvePath(params.scope);
        try {
          const currentContent =
            await this.storageService.readFile(memoryFilePath);
          return computeNewContent(
            currentContent,
            params.fact ?? params.content ?? '',
          );
        } catch (err) {
          const error = err as Error & { code?: string };
          if (!(error instanceof Error) || error.code !== 'ENOENT') throw err;
          return computeNewContent('', params.fact ?? params.content ?? '');
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
