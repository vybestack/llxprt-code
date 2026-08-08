/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helper that assembles the system instruction for compression LLM
 * calls (issue #3136, Step 3).
 *
 * Today the three compression call sites (OneShotStrategy.callProvider,
 * MiddleOutStrategy.callProvider, runVerificationPass) omit
 * `systemInstruction` from their `provider.generateChatCompletion` options.
 * The provider then rebuilds a core prompt via `getCoreSystemPromptAsync`.
 * Once provider-side assembly is removed (next task) these calls would send
 * NO system prompt at all.
 *
 * This helper reproduces the EXACT arguments the provider path uses so the
 * compression LLM receives the same system prompt it does today. It lives in
 * `packages/agents` — NOT `packages/core` — so a future `no-restricted-imports`
 * guard on `getCoreSystemPromptAsync` in providers does not let providers
 * reach it indirectly.
 */

import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';

/**
 * Build the system instruction for a compression request.
 *
 * Replicates the provider's `getCoreSystemPromptAsync` arguments exactly:
 * no `coreMemory` (matches current provider behavior), no tools
 * (`includeSubagentDelegation` is therefore `false`), and `interactionMode`
 * derived from `config.isInteractive()`.
 *
 * @param config - The Config to read MCP instructions and interaction mode from
 * @param model  - The resolved model (same as `resolved.model` on the wire)
 * @returns The assembled system instruction, or `undefined` when the
 *          prompt is empty
 */
export async function buildCompressionSystemInstruction(
  config: Config | undefined,
  model: string,
): Promise<string> {
  const mcpClientManager =
    config != null && typeof config.getMcpClientManager === 'function'
      ? config.getMcpClientManager()
      : undefined;
  const mcpInstructions = mcpClientManager
    ? mcpClientManager.getMcpInstructions()
    : undefined;

  const interactionMode =
    config != null &&
    typeof config.isInteractive === 'function' &&
    config.isInteractive() === true
      ? 'interactive'
      : 'non-interactive';

  const corePrompt = await getCoreSystemPromptAsync({
    mcpInstructions,
    model,
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
}): Promise<RuntimeGenerateChatOptions> {
  const config = params.resolvedConfig ?? params.fallbackConfig;
  const systemInstruction = await buildCompressionSystemInstruction(
    config,
    params.resolvedOptions?.model ?? params.fallbackModel,
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
