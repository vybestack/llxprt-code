/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PromptInvocation {
  readonly signal: AbortSignal;
  readonly invocation?: {
    readonly raw: string;
    readonly name: string;
    readonly args: string;
  };
  readonly session: { readonly sessionShellAllowlist: Set<string> };
}

/**
 * Defines the interface for a prompt processor, a module that can transform
 * a prompt string before it is sent to the model. Processors are chained
 * together to create a processing pipeline.
 */
export interface IPromptProcessor {
  /**
   * Processes a prompt string, applying a specific transformation as part of a pipeline.
   *
   * Each processor in a command's pipeline receives the output of the previous
   * processor. Processors receive invocation data and cancellation; owner operations
   * are captured when the command is registered.
   *
   * @param prompt The current state of the prompt string. This may have been
   *   modified by previous processors in the pipeline.
   * @param context Invocation arguments, shell approvals and cancellation.
   * @returns A promise that resolves to the transformed prompt string, which
   *   will be passed to the next processor or, if it's the last one, sent to the model.
   */
  process(prompt: string, context: PromptInvocation): Promise<string>;
}

/**
 * The placeholder string for shorthand argument injection in custom commands.
 * When used outside of !{...}, arguments are injected raw.
 * When used inside !{...}, arguments are shell-escaped.
 */
export const SHORTHAND_ARGS_PLACEHOLDER = '{{args}}';

/**
 * The trigger string for shell command injection in custom commands.
 */
export const SHELL_INJECTION_TRIGGER = '!{';
