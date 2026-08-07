/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class InvalidContextBudgetError extends Error {
  constructor(
    message: string,
    readonly configuredBudget: number,
    readonly contextLimit: number,
  ) {
    super(message);
    this.name = 'InvalidContextBudgetError';
  }
}

/**
 * Build an {@link InvalidContextBudgetError} for an explicitly configured
 * completion budget that equals or exceeds the whole context window — a
 * genuinely impossible configuration that would leave zero tokens for any
 * request.
 *
 * The message names both numbers and the settings to change so the user can
 * resolve the contradiction. Unlike a collision with the *unconfigured*
 * default (which is our bug and is fixed by scaling the default down), a
 * user-configured contradiction is a user error and must fail fast.
 */
export function buildInvalidContextBudgetError(
  configuredBudget: number,
  contextLimit: number,
  source: 'maxOutputTokens' | 'generationConfig' | 'providerParams',
): InvalidContextBudgetError {
  const settingMap: Record<typeof source, string> = {
    maxOutputTokens: '/set maxOutputTokens',
    generationConfig: 'generationConfig.maxOutputTokens',
    providerParams: 'the provider params maxOutputTokens/maxTokens',
  };
  const settingToChange = settingMap[source];

  const message =
    `Configured completion budget (${configuredBudget}) is greater than or equal to the context limit ` +
    `(${contextLimit}), leaving no room for any prompt. Lower ${settingToChange} or raise context-limit so that ` +
    `context-limit strictly exceeds the completion budget.`;

  return new InvalidContextBudgetError(message, configuredBudget, contextLimit);
}
