/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import path from 'path';
import toml from '@iarna/toml';
import { glob } from 'glob';
import { z } from 'zod';
import type { Config } from '@vybestack/llxprt-code-core';
import { Storage, debugLogger } from '@vybestack/llxprt-code-core';
import type { ICommandLoader } from './types.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';
import { DefaultArgumentProcessor } from './prompt-processors/argumentProcessor.js';
import type { IPromptProcessor } from './prompt-processors/types.js';
import {
  SHORTHAND_ARGS_PLACEHOLDER,
  SHELL_INJECTION_TRIGGER,
} from './prompt-processors/types.js';
import {
  ConfirmationRequiredError,
  ShellProcessor,
} from './prompt-processors/shellProcessor.js';

interface CommandDirectory {
  path: string;
  extensionName?: string;
}

/**
 * Defines the Zod schema for a command definition file. This serves as the
 * single source of truth for both validation and type inference.
 */
const TomlCommandDefSchema = z.object({
  prompt: z.string({
    required_error: "The 'prompt' field is required.",
    invalid_type_error: "The 'prompt' field must be a string.",
  }),
  description: z.string().optional(),
});

/**
 * Discovers and loads custom slash commands from .toml files in both the
 * user's global config directory and the current project's directory.
 *
 * This loader is responsible for:
 * - Recursively scanning command directories.
 * - Parsing and validating TOML files.
 * - Adapting valid definitions into executable SlashCommand objects.
 * - Handling file system errors and malformed files gracefully.
 */
export class FileCommandLoader implements ICommandLoader {
  private readonly projectRoot: string;
  private readonly folderTrustEnabled: boolean;
  private readonly isTrustedFolder: boolean;

  constructor(private readonly config: Config | null) {
    this.folderTrustEnabled = config?.getFolderTrust() === true;
    this.isTrustedFolder = config?.isTrustedFolder() === true;
    this.projectRoot = config?.getProjectRoot() ?? process.cwd();
  }

  /**
   * Loads all commands from user, project, and extension directories.
   * Returns commands in order: user → project → extensions (alphabetically).
   *
   * Order is important for conflict resolution in CommandService:
   * - User/project commands (without extensionName) use "last wins" strategy
   * - Extension commands (with extensionName) get renamed if conflicts exist
   *
   * @param signal An AbortSignal to cancel the loading process.
   * @returns A promise that resolves to an array of all loaded SlashCommands.
   */
  async loadCommands(signal: AbortSignal): Promise<SlashCommand[]> {
    if (this.folderTrustEnabled && !this.isTrustedFolder) {
      return [];
    }

    const allCommands: SlashCommand[] = [];
    const globOptions = {
      nodir: true,
      dot: true,
      signal,
      follow: true,
    };

    // Load commands from each directory
    const commandDirs = this.getCommandDirectories();
    for (const dirInfo of commandDirs) {
      try {
        const files = await glob('**/*.toml', {
          ...globOptions,
          cwd: dirInfo.path,
        });

        const commandPromises = files.map((file) =>
          this.parseAndAdaptFile(
            path.join(dirInfo.path, file),
            dirInfo.path,
            dirInfo.extensionName,
          ),
        );

        const commands = (await Promise.all(commandPromises)).filter(
          (cmd): cmd is SlashCommand => cmd !== null,
        );

        // Add all commands without deduplication
        allCommands.push(...commands);
      } catch (error) {
        const errorCode =
          error == null ? undefined : (error as { code?: unknown }).code;
        if (!signal.aborted && errorCode !== 'ENOENT') {
          debugLogger.error(
            `[FileCommandLoader] Error loading commands from ${dirInfo.path}:`,
            error,
          );
        }
      }
    }

    return allCommands;
  }

  /**
   * Get all command directories in order for loading.
   * User commands → Project commands → Extension commands
   * This order ensures extension commands can detect all conflicts.
   */
  private getCommandDirectories(): CommandDirectory[] {
    const dirs: CommandDirectory[] = [];

    const storage = this.config?.storage ?? new Storage(this.projectRoot);

    // 1. User commands
    dirs.push({ path: Storage.getUserCommandsDir() });

    // 2. Project commands (override user commands)
    dirs.push({ path: storage.getProjectCommandsDir() });

    // 3. Extension commands (processed last to detect all conflicts)
    if (this.config) {
      const activeExtensions = this.config
        .getExtensions()
        .filter((ext) => ext.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically for deterministic loading

      const extensionCommandDirs = activeExtensions.map((ext) => ({
        path: path.join(ext.path, 'commands'),
        extensionName: ext.name,
      }));

      dirs.push(...extensionCommandDirs);
    }

    return dirs;
  }

  /**
   * Parses a single .toml file and transforms it into a SlashCommand object.
   * @param filePath The absolute path to the .toml file.
   * @param baseDir The root command directory for name calculation.
   * @param extensionName Optional extension name to prefix commands with.
   * @returns A promise resolving to a SlashCommand, or null if the file is invalid.
   */
  private async parseAndAdaptFile(
    filePath: string,
    baseDir: string,
    extensionName?: string,
  ): Promise<SlashCommand | null> {
    const fileContent = await this.readFileContent(filePath);
    if (fileContent === null) return null;

    const validDef = this.validateTomlContent(filePath, fileContent);
    if (validDef === null) return null;

    const baseCommandName = this.computeCommandName(baseDir, filePath);
    const description = this.buildDescription(
      filePath,
      validDef.description,
      extensionName,
    );
    const processors = this.buildProcessors(baseCommandName, validDef.prompt);

    return {
      name: baseCommandName,
      description,
      kind: CommandKind.FILE,
      extensionName,
      action: this.createCommandAction(
        baseCommandName,
        validDef.prompt,
        processors,
      ),
    };
  }

  private async readFileContent(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      debugLogger.error(
        `[FileCommandLoader] Failed to read file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private validateTomlContent(
    filePath: string,
    fileContent: string,
  ): z.infer<typeof TomlCommandDefSchema> | null {
    let parsed: unknown;
    try {
      parsed = toml.parse(fileContent);
    } catch (error: unknown) {
      debugLogger.error(
        `[FileCommandLoader] Failed to parse TOML file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    const validationResult = TomlCommandDefSchema.safeParse(parsed);
    if (!validationResult.success) {
      debugLogger.error(
        `[FileCommandLoader] Skipping invalid command file: ${filePath}. Validation errors:`,
        validationResult.error.flatten(),
      );
      return null;
    }
    return validationResult.data;
  }

  private computeCommandName(baseDir: string, filePath: string): string {
    const relativePathWithExt = path.relative(baseDir, filePath);
    const relativePath = relativePathWithExt.substring(
      0,
      relativePathWithExt.length - 5, // length of '.toml'
    );
    return relativePath
      .split(path.sep)
      .map((segment) => segment.replaceAll(':', '_'))
      .join(':');
  }

  private buildDescription(
    filePath: string,
    promptDescription: string | undefined,
    extensionName?: string,
  ): string {
    const defaultDescription = `Custom command from ${path.basename(filePath)}`;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string description sentinel
    let description = promptDescription || defaultDescription;
    if (extensionName) {
      description = `[${extensionName}] ${description}`;
    }
    return description;
  }

  private buildProcessors(
    baseCommandName: string,
    prompt: string,
  ): IPromptProcessor[] {
    const processors: IPromptProcessor[] = [];
    const usesArgs = prompt.includes(SHORTHAND_ARGS_PLACEHOLDER);
    const usesShellInjection = prompt.includes(SHELL_INJECTION_TRIGGER);

    if (usesShellInjection || usesArgs) {
      processors.push(new ShellProcessor(baseCommandName));
    }
    if (!usesArgs) {
      processors.push(new DefaultArgumentProcessor());
    }
    return processors;
  }

  private createCommandAction(
    baseCommandName: string,
    prompt: string,
    processors: IPromptProcessor[],
  ): (
    context: CommandContext,
    _args: string,
  ) => Promise<SlashCommandActionReturn> {
    return async (
      context: CommandContext,
      _args: string,
    ): Promise<SlashCommandActionReturn> => {
      if (!context.invocation) {
        debugLogger.error(
          `[FileCommandLoader] Critical error: Command '${baseCommandName}' was executed without invocation context.`,
        );
        return {
          type: 'submit_prompt',
          content: prompt,
        };
      }

      try {
        let processedPrompt = prompt;
        for (const processor of processors) {
          processedPrompt = await processor.process(processedPrompt, context);
        }
        return {
          type: 'submit_prompt',
          content: processedPrompt,
        };
      } catch (e) {
        if (e instanceof ConfirmationRequiredError) {
          return {
            type: 'confirm_shell_commands',
            commandsToConfirm: e.commandsToConfirm,
            originalInvocation: {
              raw: context.invocation.raw,
            },
          };
        }
        throw e;
      }
    };
  }
}
