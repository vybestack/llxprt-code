/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GenerateChatOptions } from '../IProvider.js';
import { ResponsesDiskTextRows } from '../openai-responses/responses-disk-text-rows.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getRequestSignal } from '../utils/abortSignal.js';

export interface RequestLoggingPolicy {
  readonly strictPreSend: boolean;
  readonly strictDurableResponse: boolean;
  readonly strictTelemetry: boolean;
  readonly signal: AbortSignal | undefined;
}

export function requestLoggingPolicy(
  options: GenerateChatOptions,
  config: Config,
): RequestLoggingPolicy {
  const source = options.requestRows instanceof ResponsesDiskTextRows;
  return Object.freeze({
    strictPreSend: source,
    strictDurableResponse: source,
    strictTelemetry:
      source &&
      config.getTelemetryLogApiBodiesEnabled() &&
      config.getTelemetryLogPromptsEnabled(),
    signal: getRequestSignal(options),
  });
}
