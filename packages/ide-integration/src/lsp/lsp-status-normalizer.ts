/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServerStatus } from './types.js';

function resolveHealthy(
  state: string | undefined,
  obj: Record<string, unknown>,
): boolean {
  if (state === 'ok') return true;
  if (state === 'broken' || state === 'starting') return false;
  if (typeof obj.healthy === 'boolean') return obj.healthy;
  return false;
}

export function normalizeServerStatus(raw: unknown): ServerStatus {
  const obj = raw as Record<string, unknown>;
  const serverId = String(obj.serverId ?? '');
  const state = typeof obj.state === 'string' ? obj.state : undefined;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const healthy = resolveHealthy(state, obj);

  return {
    serverId,
    healthy,
    detail: typeof obj.detail === 'string' ? obj.detail : (state ?? status),
    state: state as ServerStatus['state'],
    status,
  };
}
