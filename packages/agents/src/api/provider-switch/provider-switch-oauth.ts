/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

export interface SwitchOAuthOperations {
  register(): void;
  isEnabled(): boolean;
  enable(): Promise<void>;
  authenticate(): Promise<void>;
}

export interface SwitchOAuthPolicy {
  readonly explicitAutoOAuth: boolean | undefined;
  readonly isInteractive: boolean;
  readonly runtimeKind: RuntimeKind | undefined;
}

export function resolveLazyClaudeCodeOAuthDecision(input: {
  explicitAutoOAuth?: boolean;
  isInteractive: boolean;
  runtimeKind?: RuntimeKind;
}): boolean {
  if (input.explicitAutoOAuth === true) return true;
  if (input.explicitAutoOAuth === false) return false;
  return (
    input.isInteractive &&
    input.runtimeKind !== 'agent' &&
    input.runtimeKind !== 'subagent'
  );
}

export async function authenticateSwitchOAuth(
  policy: SwitchOAuthPolicy,
  oauth: SwitchOAuthOperations,
  hasNonOAuthAuthentication: () => Promise<boolean>,
): Promise<readonly string[]> {
  oauth.register();
  if (!resolveLazyClaudeCodeOAuthDecision(policy)) return [];
  try {
    if (await hasNonOAuthAuthentication()) return [];
    if (!oauth.isEnabled()) await oauth.enable();
    await oauth.authenticate();
    return [
      'Claude Code OAuth authentication completed. Use /auth claudecode to view status.',
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`Claude Code OAuth authentication failed: ${message}`];
  }
}

export function restoreSwitchOAuthDefaults(
  previous: Readonly<Record<string, unknown>>,
  oauthEnabled: boolean,
  write: (key: string, value: unknown) => void,
): readonly string[] {
  if (
    previous.authOnly !== true &&
    previous.authOnly !== 'true' &&
    !oauthEnabled
  )
    return [];
  if (previous['context-limit'] !== undefined)
    write('context-limit', previous['context-limit']);
  if (previous.max_tokens !== undefined)
    write('max_tokens', previous.max_tokens);
  else if (
    typeof previous.maxOutputTokens === 'number' &&
    Number.isFinite(previous.maxOutputTokens) &&
    previous.maxOutputTokens > 0
  ) {
    write('maxOutputTokens', previous.maxOutputTokens);
    if (previous.authOnly !== undefined) write('authOnly', previous.authOnly);
    return ['maxOutputTokens'];
  }
  if (previous.authOnly !== undefined) write('authOnly', previous.authOnly);
  return [];
}
