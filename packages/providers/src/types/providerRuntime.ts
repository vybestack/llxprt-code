/**
 * Shared runtime-scoped provider types that support stateless integrations.
 * @plan PLAN-20251023-STATELESS-HARDENING.P05
 * @requirement REQ-SP4-002
 */

/**
 * One authorization result: the bearer and, when the credential source knows
 * it, the account identity that belongs to that same credential.
 * `identity: 'absent'` means the source read the full stored credential and it
 * has no account identity; no later lookup can supply one.
 */
export interface RequestCredential {
  readonly token: string;
  readonly accountId?: string;
  readonly identity?: 'absent';
}

export interface RuntimeAuthTokenProvider {
  provide: () => Promise<string | undefined> | string | undefined;
  /**
   * Resolves the bearer together with its account identity from ONE credential
   * read. Providers whose requests carry an identity beside the bearer (Codex)
   * consume this instead of reading the store a second time.
   */
  provideCredential?: () => Promise<RequestCredential>;
}

export type ResolvedAuthToken = string | RuntimeAuthTokenProvider;

export interface ProviderTelemetryContext {
  record?: (eventName: string, payload: Record<string, unknown>) => void;
  [key: string]: unknown;
}

export interface UserMemoryProfileProvider {
  getProfile:
    | (() => Promise<string | Record<string, unknown> | undefined>)
    | (() => string | Record<string, unknown> | undefined);
}

export type UserMemoryInput = string | UserMemoryProfileProvider;

/**
 * Caller-supplied renderer for the assembled system prompt, parameterized by
 * the model that will appear on the wire (issue #3157).
 *
 * Structurally identical to `RuntimeSystemPromptAssembler` (core) and to the
 * agent layer's `SystemPromptAssembler` so the same object flows across all
 * three declarations with no adapter and no cross-package import.
 */
export interface SystemPromptAssembler {
  assemble(request: {
    provider: string | undefined;
    model: string;
  }): Promise<string>;
}
