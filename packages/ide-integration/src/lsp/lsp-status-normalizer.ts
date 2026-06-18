/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServerStatus } from './types.js';

const ALLOWED_STATES = new Set(['ok', 'broken', 'starting', 'idle']);

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
  if (typeof raw !== 'object' || raw === null) {
    return { serverId: '', healthy: false };
  }
  const obj = raw as Record<string, unknown>;
  const serverId = String(obj.serverId ?? '');
  const stateStr = typeof obj.state === 'string' ? obj.state : undefined;
  const state = ALLOWED_STATES.has(stateStr ?? '')
    ? (stateStr as ServerStatus['state'])
    : undefined;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const healthy = resolveHealthy(stateStr, obj);

  return {
    serverId,
    healthy,
    detail: typeof obj.detail === 'string' ? obj.detail : (stateStr ?? status),
    state,
    status,
  };
}
