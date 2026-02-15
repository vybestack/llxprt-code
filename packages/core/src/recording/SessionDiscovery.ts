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
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-003
 * @pseudocode session-management.md lines 10-67
 *
 * Session discovery utility. Scans a chats directory for session files,
 * reads headers to extract metadata, and resolves session references
 * for the resume flow.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { type SessionSummary, type SessionStartPayload } from './types.js';
import { readSessionHeader } from './ReplayEngine.js';

/**
 * Result of successfully resolving a session reference.
 */
export interface SessionResolution {
  session: SessionSummary;
}

/**
 * Result when a session reference cannot be resolved.
 */
export interface SessionResolutionError {
  error: string;
}

/**
 * Read the first line from a file using a partial buffer read.
 * Much faster than opening a readline stream for each file.
 */
async function readFirstLineFromFile(
  filePath: string,
): Promise<SessionStartPayload | null> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096, 0);
    if (bytesRead === 0) return null;

    let chunk = buf.subarray(0, bytesRead).toString('utf-8');
    if (chunk.startsWith('\uFEFF')) chunk = chunk.slice(1);

    const newlineIdx = chunk.indexOf('\n');

    // Fallback: if the first line exceeds the 4096-byte buffer, delegate to
    // readSessionHeader which uses a full readline stream.
    if (newlineIdx < 0 && bytesRead === buf.length) {
      await fh.close();
      fh = undefined;
      return readSessionHeader(filePath);
    }

    const firstLine = newlineIdx >= 0 ? chunk.slice(0, newlineIdx) : chunk;
    if (firstLine.trim() === '') return null;

    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type !== 'session_start') return null;
    return parsed.payload as SessionStartPayload;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/**
 * Static utility class for discovering and resolving session files.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-003
 * @pseudocode session-management.md lines 10-67
 */
export class SessionDiscovery {
  /**
   * List all sessions in a chats directory matching the given project hash,
   * sorted newest-first by file modification time.
   *
   * @pseudocode session-management.md lines 12-44
   */
  static async listSessions(
    chatsDir: string,
    projectHash: string,
  ): Promise<SessionSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(chatsDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const sessionFiles = entries.filter(
      (f) => f.startsWith('session-') && f.endsWith('.jsonl'),
    );

    const summaries: SessionSummary[] = [];
    for (const fileName of sessionFiles) {
      const filePath = path.join(chatsDir, fileName);

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }

      const header = await readFirstLineFromFile(filePath);
      if (header === null) continue;
      if (header.projectHash !== projectHash) continue;

      summaries.push({
        sessionId: header.sessionId,
        filePath,
        projectHash: header.projectHash,
        startTime: header.startTime,
        lastModified: stat.mtime,
        fileSize: stat.size,
        provider: header.provider,
        model: header.model,
      });
    }

    summaries.sort((a, b) => {
      const mtimeDiff = b.lastModified.getTime() - a.lastModified.getTime();
      if (mtimeDiff !== 0) return mtimeDiff;
      return b.sessionId.localeCompare(a.sessionId);
    });

    return summaries;
  }

  /**
   * Resolve a user-provided session reference (session ID, prefix, or index)
   * against a list of known sessions.
   *
   * Resolution precedence:
   * 1. Exact session ID match
   * 2. If ref is all digits → treat as 1-based numeric index
   * 3. Unique prefix match (ambiguous → error listing matching IDs)
   * 4. Not found → error
   *
   * @pseudocode session-management.md lines 47-67
   */
  static resolveSessionRef(
    ref: string,
    sessions: SessionSummary[],
  ): SessionResolution | SessionResolutionError {
    const exactMatch = sessions.find((s) => s.sessionId === ref);
    if (exactMatch) return { session: exactMatch };

    if (/^\d+$/.test(ref)) {
      const indexNum = parseInt(ref, 10);
      if (indexNum >= 1 && indexNum <= sessions.length) {
        return { session: sessions[indexNum - 1] };
      }
      return {
        error: `Session index ${ref} out of range (1-${sessions.length})`,
      };
    }

    const prefixMatches = sessions.filter((s) => s.sessionId.startsWith(ref));
    if (prefixMatches.length === 1) return { session: prefixMatches[0] };
    if (prefixMatches.length > 1) {
      const ids = prefixMatches.map((s) => s.sessionId).join(', ');
      return {
        error: `Ambiguous session prefix '${ref}' matches: ${ids}`,
      };
    }

    return { error: `Session not found for this project: ${ref}` };
  }

  /**
   * Read only the session header (first line) from a JSONL file.
   * Delegates to the existing readSessionHeader in ReplayEngine.
   *
   * @pseudocode resume-flow.md header reading
   */
  static async readSessionHeader(
    filePath: string,
  ): Promise<SessionStartPayload | null> {
    return readSessionHeader(filePath);
  }
}
