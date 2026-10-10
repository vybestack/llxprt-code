/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export function resolveAndValidateConfig(
  diagnostics: ProviderRequestDiagnostics | undefined,
  runtimeId: string | undefined,
  debug: DebugLogger,
): ProviderRequestDiagnostics {
  debug.log(
    () => `Admitted request diagnostics available=${diagnostics !== undefined}`,
  );
  if (diagnostics === undefined)
    throw new Error(
      `[REQ-SP4-004] FAST FAIL: No request diagnostics for runtimeId=${runtimeId ?? 'unknown'}`,
    );
  return diagnostics;
}
