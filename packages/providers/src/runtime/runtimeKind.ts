/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

export function resolveRuntimeKind(
  requestedKind: RuntimeKind | undefined,
  metadata: Record<string, unknown> | undefined,
  fallback: RuntimeKind,
): RuntimeKind {
  if (requestedKind) return requestedKind;
  return metadata?.['source'] === 'cli-bootstrap' ? 'cli-bootstrap' : fallback;
}
