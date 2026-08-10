/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helper that assembles the system instruction for compression LLM
 * calls (issue #3136, Step 3).
 *
 * The three compression call sites (OneShotStrategy.callProvider,
 * MiddleOutStrategy.callProvider, runVerificationPass) all obtain their
 * `systemInstruction` from here. Providers no longer rebuild a core prompt and
 * now throw when the instruction is absent, so without this helper these calls
 * would fail rather than silently send a prompt-less request.
 *
 * It lives in `packages/agents` — NOT `packages/core` — so providers cannot
 * reach it and thereby sidestep the `no-restricted-imports` guard on
 * `getCoreSystemPromptAsync` (`eslint.config.js`), which only bans the direct
 * import. The placement is intended to prevent the indirect route: the manifests
 * declare `packages/agents` depending on `packages/providers`, so the reverse
 * import would invert that direction. Note this is a convention, not an enforced
 * invariant — no package-cycle check or build rule currently verifies it.
 */

import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';

type CompressionInteractionMode =
  | 'interactive'
  | 'non-interactive'
  | 'subagent';

export type { CompressionInteractionMode };

/** Brands the compression-specific load-balancer wrapper. */
export const COMPRESSION_LOAD_BALANCER_WRAPPER = Symbol(
  'compression-load-balancer-wrapper',
);

interface CompressionLoadBalancerWrapper extends IProvider {
  readonly [COMPRESSION_LOAD_BALANCER_WRAPPER]: true;
}

/**
 * Derives the interaction mode from `config.isInteractive()` when no explicit
 * mode is supplied. Shared by both compression entry points.
 */
function deriveInteractiveMode(
  config: Config | undefined,
): CompressionInteractionMode {
  if (
    config != null &&
    typeof config.isInteractive === 'function' &&
    config.isInteractive() === true
  ) {
    return 'interactive';
  }
  return 'non-interactive';
}

/**
 * Returns `true` when the runtime state belongs to a subagent — the marker
 * that makes compression render `'subagent'` (issue #3176, D8).
 */
function isSubagentRuntime(runtimeState: AgentRuntimeState): boolean {
  return (
    typeof runtimeState.subagentName === 'string' &&
    runtimeState.subagentName.trim() !== ''
  );
}

/**
 * Single derivation point for the compressed session's interaction mode
 * (issue #3176, D8). Returns `'subagent'` when the runtime state belongs to a
 * subagent, otherwise falls back to `config.isInteractive()`.
 *
 * Used by {@link buildCompressionChatOptions} (ordinary compression) and by
 * {@link CompressionLoadBalancingProvider} (load-balanced compression) so the
 * mode is consistent across every candidate.
 */
export function deriveCompressionInteractionMode(
  config: Config | undefined,
  runtimeState: AgentRuntimeState,
): CompressionInteractionMode {
  return isSubagentRuntime(runtimeState)
    ? 'subagent'
    : deriveInteractiveMode(config);
}

/** Validates the concrete provider identity for ordinary compression. */
function requireCompressionProvider(providerName: string): string {
  if (providerName.trim() === '') {
    throw new Error('Compression provider identity is required');
  }
  return providerName;
}

function isCompressionLoadBalancerWrapper(
  provider: IProvider,
): provider is CompressionLoadBalancerWrapper {
  return (
    COMPRESSION_LOAD_BALANCER_WRAPPER in provider &&
    provider[COMPRESSION_LOAD_BALANCER_WRAPPER] === true
  );
}

/**
 * Build the system instruction for a compression request.
 *
 * Passes no `userMemory`, an explicit empty `coreMemory` string, no
 * `mcpInstructions`, no tools (`includeSubagentDelegation` is therefore
 * `false`), and the caller-supplied request interaction mode.
 *
 * The empty `coreMemory` string (not `undefined`) is deliberate: when
 * `coreMemory` is `undefined`, `getCoreSystemPromptAsync` loads
 * `.LLXPRT_SYSTEM` from disk (`resolveEffectiveMemories` in
 * `packages/core/src/core/prompts.ts`) and merges `mcpInstructions` into the
 * same channel. Passing `''` short-circuits that disk fallback, and omitting
 * `mcpInstructions` keeps MCP-server instructions out, so the compression LLM
 * receives only the base instruction appropriate to its model and interaction
 * mode — never the caller's core memory or MCP instructions (issue #3174).
 *
 * The `provider` and `interactionMode` are caller-supplied and request-scoped
 * (issue #3176, D5 + D8). Ordinary compression derives them through
 * {@link buildCompressionChatOptions}; load-balanced compression supplies the
 * selected candidate provider and the compressed session's interaction mode.
 *
 * @param model  - The resolved model (same as `resolved.model` on the wire)
 * @param options - Request-scoped `provider` and `interactionMode`; both
 *                  required, derived by {@link buildCompressionChatOptions}
 * @returns The assembled system instruction
 */
export async function buildCompressionSystemInstruction(
  model: string,
  options: {
    provider: string;
    interactionMode: CompressionInteractionMode;
  },
): Promise<string> {
  const interactionMode = options.interactionMode;
  const provider = requireCompressionProvider(options.provider);

  const corePrompt = await getCoreSystemPromptAsync({
    coreMemory: '',
    model,
    provider,
    tools: undefined,
    includeSubagentDelegation: false,
    interactionMode,
  });

  // Returned as-is rather than coerced to undefined on empty. Providers now
  // require a non-empty instruction, so silently turning '' into undefined
  // would just relabel the same failure while hiding that the prompt service
  // produced nothing.
  return corePrompt;
}

/**
 * Build the complete `generateChatCompletion` options for a compression call.
 *
 * The three compression call sites construct an identical options object apart
 * from `contents` and the telemetry `source`. Centralising it here keeps the
 * system-instruction wiring in one place, so a future change to the compression
 * prompt cannot silently apply to only two of the three paths.
 */
export async function buildCompressionChatOptions(params: {
  contents: IContent[];
  providerRuntime: ProviderRuntimeContext;
  resolvedConfig: Config | undefined;
  fallbackConfig: Config | undefined;
  resolvedOptions: RuntimeGenerateChatOptions['resolved'] | undefined;
  invocation: RuntimeGenerateChatOptions['invocation'] | undefined;
  fallbackModel: string;
  source: string;
  runtimeState: AgentRuntimeState;
  provider: IProvider;
}): Promise<RuntimeGenerateChatOptions> {
  const config = params.resolvedConfig ?? params.fallbackConfig;

  // Single derivation point for the request-scoped provider and the
  // compressed session's interaction mode (issue #3176, D5 + D8). All three
  // call sites thread these through here so none can drift.
  const providerName = requireCompressionProvider(params.provider.name);
  const interactionMode = deriveCompressionInteractionMode(
    config,
    params.runtimeState,
  );
  // Only the branded wrapper defers assembly. A concrete provider that happens
  // to use the same display name must still receive its own prompt.
  const systemInstruction = isCompressionLoadBalancerWrapper(params.provider)
    ? undefined
    : await buildCompressionSystemInstruction(
        params.resolvedOptions?.model ?? params.fallbackModel,
        { provider: providerName, interactionMode },
      );

  return {
    contents: params.contents,
    tools: undefined,
    config: config ?? params.providerRuntime.config,
    runtime: params.providerRuntime,
    invocation: params.invocation,
    settings: params.providerRuntime
      .settingsService as RuntimeGenerateChatOptions['settings'],
    resolved: params.resolvedOptions,
    systemInstruction,
    metadata: {
      ...(params.providerRuntime.metadata ?? {}),
      source: params.source,
    },
  };
}
