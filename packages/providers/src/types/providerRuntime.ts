/**
 * Shared runtime-scoped provider types that support stateless integrations.
 * @plan PLAN-20251023-STATELESS-HARDENING.P05
 * @requirement REQ-SP4-002
 */

export interface RuntimeAuthTokenProvider {
  provide: () => Promise<string | undefined> | string | undefined;
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
