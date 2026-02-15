/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P21
 * @requirement REQ-MGT-001, REQ-MGT-002, REQ-MGT-003
 * @pseudocode session-management.md lines 70-130
 *
 * Session management commands (core layer). Returns data objects only —
 * no table formatting, no console output, no terminal colors.
 */

import { type SessionSummary } from './types.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';

/**
 * Result of listing sessions for a project.
 */
export interface ListSessionsResult {
  sessions: SessionSummary[];
}

/**
 * Successful session deletion result.
 */
export interface DeleteSessionResult {
  ok: true;
  deletedSessionId: string;
}

/**
 * Failed session deletion result.
 */
export interface DeleteSessionError {
  ok: false;
  error: string;
}

/**
 * List all sessions matching the given project hash, sorted newest-first.
 *
 * @pseudocode session-management.md lines 75-98
 */
export async function listSessions(
  chatsDir: string,
  projectHash: string,
): Promise<ListSessionsResult> {
  const sessions = await SessionDiscovery.listSessions(chatsDir, projectHash);
  return { sessions };
}

/**
 * Delete a session identified by ref (session ID, prefix, or 1-based index).
 * Refuses to delete a session that is actively locked by another process.
 *
 * @pseudocode session-management.md lines 105-150
 */
export async function deleteSession(
  ref: string,
  chatsDir: string,
  projectHash: string,
): Promise<DeleteSessionResult | DeleteSessionError> {
  const sessions = await SessionDiscovery.listSessions(chatsDir, projectHash);

  if (sessions.length === 0) {
    return { ok: false, error: 'No sessions found for this project' };
  }

  const resolved = SessionDiscovery.resolveSessionRef(ref, sessions);
  if ('error' in resolved) {
    return { ok: false, error: resolved.error };
  }

  const target = resolved.session;

  const locked = await SessionLockManager.isLocked(chatsDir, target.sessionId);
  if (locked) {
    const stale = await SessionLockManager.isStale(chatsDir, target.sessionId);
    if (stale) {
      await SessionLockManager.removeStaleLock(chatsDir, target.sessionId);
    } else {
      return {
        ok: false,
        error: 'Cannot delete: session is in use by another process',
      };
    }
  }

  const { unlink } = await import('node:fs/promises');

  try {
    await unlink(target.filePath);
  } catch (error: unknown) {
    return {
      ok: false,
      error: `Failed to delete session: ${(error as Error).message}`,
    };
  }

  const lockPath = SessionLockManager.getLockPath(chatsDir, target.sessionId);
  try {
    await unlink(lockPath);
  } catch {
    // Lock file may not exist
  }

  return { ok: true, deletedSessionId: target.sessionId };
}
