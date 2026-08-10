/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApprovalMode,
  checkCommandPermissions,
  escapeShellArg,
  getShellConfiguration,
  ShellExecutionService,
  type ShellPermissionConfig,
} from '@vybestack/llxprt-code-core';

import type { CommandContext } from '../../ui/commands/types.js';
import type {
  ApprovalState,
  SessionIdentity,
  ShellState,
} from '../../ui/cliUiRuntime.js';
import type { IPromptProcessor } from './types.js';
import {
  SHELL_INJECTION_TRIGGER,
  SHORTHAND_ARGS_PLACEHOLDER,
} from './types.js';
import { StreamingInjectionBuilder } from './injectionOutputBudget.js';
import { resolveByteBudgetFromSetting } from '@vybestack/llxprt-code-tools/acquisition.js';

type ShellProcessorRuntime = ShellPermissionConfig &
  ApprovalState &
  SessionIdentity &
  ShellState;

export class ConfirmationRequiredError extends Error {
  constructor(
    message: string,
    public commandsToConfirm: string[],
  ) {
    super(message);
    this.name = 'ConfirmationRequiredError';
  }
}

/**
 * Represents a single detected shell injection site in the prompt.
 */
interface ShellInjection {
  /** The shell command extracted from within !{...}, trimmed. */
  command: string;
  /** The starting index of the injection (inclusive, points to '!'). */
  startIndex: number;
  /** The ending index of the injection (exclusive, points after '}'). */
  endIndex: number;
  /** The command after {{args}} has been escaped and substituted. */
  resolvedCommand?: string;
}

/**
 * Handles prompt interpolation, including shell command execution (`!{...}`)
 * and context-aware argument injection (`{{args}}`).
 *
 * This processor ensures that:
 * 1. `{{args}}` outside `!{...}` are replaced with raw input.
 * 2. `{{args}}` inside `!{...}` are replaced with shell-escaped input.
 * 3. Shell commands are executed securely after argument substitution.
 * 4. Parsing correctly handles nested braces.
 */
export class ShellProcessor implements IPromptProcessor {
  constructor(private readonly commandName: string) {}

  async process(prompt: string, context: CommandContext): Promise<string> {
    const userArgsRaw = context.invocation?.args ?? '';

    if (!prompt.includes(SHELL_INJECTION_TRIGGER)) {
      return prompt.replaceAll(SHORTHAND_ARGS_PLACEHOLDER, userArgsRaw);
    }

    const config = context.services.config;
    if (!config) {
      throw new Error(
        `Security configuration not loaded. Cannot verify shell command permissions for '${this.commandName}'. Aborting.`,
      );
    }
    const { sessionShellAllowlist } = context.session;

    const injections = this.extractInjections(prompt);
    // If extractInjections found no closed blocks (and didn't throw), treat as raw.
    if (injections.length === 0) {
      return prompt.replaceAll(SHORTHAND_ARGS_PLACEHOLDER, userArgsRaw);
    }

    const { shell } = getShellConfiguration();
    const userArgsEscaped = escapeShellArg(userArgsRaw, shell);

    const resolvedInjections = this.resolveInjections(
      injections,
      userArgsEscaped,
    );
    this.checkPermissions(resolvedInjections, config, sessionShellAllowlist);

    return this.executeInjections(
      prompt,
      resolvedInjections,
      config,
      userArgsRaw,
    );
  }

  private resolveInjections(
    injections: ShellInjection[],
    userArgsEscaped: string,
  ): ShellInjection[] {
    return injections.map((injection) => {
      if (injection.command === '') {
        return injection;
      }
      const resolvedCommand = injection.command.replaceAll(
        SHORTHAND_ARGS_PLACEHOLDER,
        userArgsEscaped,
      );
      return { ...injection, resolvedCommand };
    });
  }

  private checkPermissions(
    resolvedInjections: ShellInjection[],
    config: ShellProcessorRuntime,
    sessionShellAllowlist: Set<string>,
  ): void {
    const commandsToConfirm = new Set<string>();
    for (const injection of resolvedInjections) {
      const command = injection.resolvedCommand;
      if (!command) continue;

      const { allAllowed, disallowedCommands, blockReason, isHardDenial } =
        checkCommandPermissions(command, config, sessionShellAllowlist);

      if (allAllowed !== true) {
        if (isHardDenial === true) {
          throw new Error(
            `Blocked command: "${command}". Reason: ${blockReason ?? 'Blocked by configuration.'}`,
          );
        }
        if (config.getApprovalMode() !== ApprovalMode.YOLO) {
          disallowedCommands.forEach((uc) => commandsToConfirm.add(uc));
        }
      }
    }

    if (commandsToConfirm.size > 0) {
      throw new ConfirmationRequiredError(
        'Shell command confirmation required',
        Array.from(commandsToConfirm),
      );
    }
  }

  private async executeInjections(
    prompt: string,
    resolvedInjections: ShellInjection[],
    config: ShellProcessorRuntime,
    userArgsRaw: string,
  ): Promise<string> {
    // Resolve the aggregate injection-output budget from the configured shell
    // acquisition setting so prompt injection is bounded by the same finite
    // policy as direct shell execution (issue #3200 finding 2). The streaming
    // builder retains at most one global output budget across all injections
    // and never holds all command outputs simultaneously.
    const builder = new StreamingInjectionBuilder(
      resolveByteBudgetFromSetting(
        config.getShellExecutionConfig().outputRetentionMaxBytes,
      ),
    );
    let lastIndex = 0;

    for (const injection of resolvedInjections) {
      // Literal text BEFORE this injection, substituting {{args}} with RAW input.
      const segment = prompt.substring(lastIndex, injection.startIndex);
      builder.appendLiteral(
        segment.replaceAll(SHORTHAND_ARGS_PLACEHOLDER, userArgsRaw),
      );

      // Execute the resolved command (which already has ESCAPED input) so side
      // effects always run, then feed the output to the streaming builder so
      // the full output is reduced to a bounded head/tail immediately.
      if (injection.resolvedCommand) {
        const { result } = await ShellExecutionService.execute(
          injection.resolvedCommand,
          config.getTargetDir(),
          () => {},
          new AbortController().signal,
          config.getShouldUseNodePtyShell(),
          config.getShellExecutionConfig(),
        );

        const executionResult = await result;

        // Handle Spawn Errors
        if (executionResult.error && !executionResult.aborted) {
          throw new Error(
            `Failed to start shell command in '${this.commandName}': ${executionResult.error.message}. Command: ${injection.resolvedCommand}`,
          );
        }

        // Build the status suffix preserving exit/signal/abort semantics.
        let statusSuffix = '';
        if (executionResult.aborted) {
          statusSuffix = `\n[Shell command '${injection.resolvedCommand}' aborted]`;
        } else if (
          executionResult.exitCode !== 0 &&
          executionResult.exitCode !== null
        ) {
          statusSuffix = `\n[Shell command '${injection.resolvedCommand}' exited with code ${executionResult.exitCode}]`;
        } else if (executionResult.signal !== null) {
          statusSuffix = `\n[Shell command '${injection.resolvedCommand}' terminated by signal ${executionResult.signal}]`;
        }

        builder.appendOutput(executionResult.output, statusSuffix);
      }

      lastIndex = injection.endIndex;
    }

    // Remaining literal text AFTER the last injection.
    const finalSegment = prompt.substring(lastIndex);
    builder.appendLiteral(
      finalSegment.replaceAll(SHORTHAND_ARGS_PLACEHOLDER, userArgsRaw),
    );

    // Build the final prompt with bounded aggregate output: every command has
    // already executed for side effects, the aggregate output bytes are bounded
    // with one accurate omission notice, and each status appears exactly once.
    return builder.build();
  }

  /**
   * Finds the closing brace for a shell injection starting at startIndex.
   * Returns the end index and command content, or null if not found.
   */
  private findInjectionEnd(
    prompt: string,
    startIndex: number,
  ): { endIndex: number; command: string } | null {
    let currentIndex = startIndex + SHELL_INJECTION_TRIGGER.length;
    let braceCount = 1;

    while (currentIndex < prompt.length) {
      const char = prompt[currentIndex];

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          const commandContent = prompt.substring(
            startIndex + SHELL_INJECTION_TRIGGER.length,
            currentIndex,
          );
          return {
            endIndex: currentIndex + 1,
            command: commandContent.trim(),
          };
        }
      }
      currentIndex++;
    }
    return null;
  }

  /**
   * Iteratively parses the prompt string to extract shell injections (!{...}),
   * correctly handling nested braces within the command.
   *
   * @param prompt The prompt string to parse.
   * @returns An array of extracted ShellInjection objects.
   * @throws Error if an unclosed injection (`!{`) is found.
   */
  private extractInjections(prompt: string): ShellInjection[] {
    const injections: ShellInjection[] = [];
    let index = 0;

    while (index < prompt.length) {
      const startIndex = prompt.indexOf(SHELL_INJECTION_TRIGGER, index);

      if (startIndex === -1) {
        break;
      }

      const result = this.findInjectionEnd(prompt, startIndex);

      if (result === null) {
        throw new Error(
          `Invalid syntax in command '${this.commandName}': Unclosed shell injection starting at index ${startIndex} ('!{'). Ensure braces are balanced.`,
        );
      }

      injections.push({
        command: result.command,
        startIndex,
        endIndex: result.endIndex,
      });

      index = result.endIndex;
    }

    return injections;
  }
}
