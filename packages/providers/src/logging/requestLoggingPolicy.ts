/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { readsRequestRowsAtTransport } from '../BaseProviderNormalization.js';
import { getRequestSignal } from '../utils/abortSignal.js';

export interface RequestLoggingPolicy {
  readonly strictPreSend: boolean;
  readonly strictDurableResponse: boolean;
  readonly strictTelemetry: boolean;
  readonly signal: AbortSignal | undefined;
}

export function requestLoggingPolicy(
  options: GenerateChatOptions,
  diagnostics: ProviderRequestDiagnostics,
): RequestLoggingPolicy {
  const source = readsRequestRowsAtTransport(options);
  return Object.freeze({
    strictPreSend: source,
    strictDurableResponse: source,
    strictTelemetry: source && diagnostics.requestBodyLoggingEnabled,
    signal: getRequestSignal(options),
  });
}
