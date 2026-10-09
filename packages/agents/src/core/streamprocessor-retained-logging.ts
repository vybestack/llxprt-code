/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RetainedOwnerCensus } from './streamprocessor-retained-census.js';

export function observeRetainedLogging(
  runtime: AgentRuntimeContext,
  census: RetainedOwnerCensus,
): () => void {
  const debug = DebugLogger.prototype.debug;
  DebugLogger.prototype.debug = function (message, ...args) {
    census.observe('logging.lazy-message', message);
    for (const value of args) census.observe('logging.argument', value);
    return debug.call(this, message, ...args);
  };
  const logRequest = runtime.telemetry.logApiRequest;
  runtime.telemetry.logApiRequest = (event) => {
    census.observe('telemetry.request-event', event);
    return logRequest.call(runtime.telemetry, event);
  };
  return () => {
    DebugLogger.prototype.debug = debug;
    runtime.telemetry.logApiRequest = logRequest;
  };
}
