/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

interface ToolResponseLike {
  readonly type: 'tool_response';
  readonly callId: string;
  readonly result: unknown;
}

/**
 * Reads the full display body of a tool result from a recorded session
 * transcript (issue #3428 AC2).
 *
 * The session JSONL is the source of truth for capped results: every tool
 * response is recorded before the UI displays it, so an expanded body is
 * always available on disk. The scan is line-wise — the file is never loaded
 * whole, and only the latest matching body is retained in memory. When a
 * callId repeats (tool retries), the LAST recorded response wins, matching
 * the replay path's response map, which overwrites duplicate callIds.
 */
export async function readToolResultBody(
  filePath: string,
  callId: string,
): Promise<string | undefined> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let lastMatch: string | undefined;
  try {
    for await (const line of reader) {
      const body = matchLine(line, callId);
      if (body !== undefined) {
        lastMatch = body;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return lastMatch;
}

function matchLine(line: string, callId: string): string | undefined {
  if (line === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const record = parsed as { type?: unknown; payload?: unknown } | null;
  if (
    typeof record !== 'object' ||
    record === null ||
    record.type !== 'content'
  ) {
    return undefined;
  }
  const payload = record.payload as { content?: unknown } | undefined;
  const content = payload?.content as
    | { speaker?: unknown; blocks?: unknown }
    | null
    | undefined;
  if (
    typeof content !== 'object' ||
    content === null ||
    content.speaker !== 'tool' ||
    !Array.isArray(content.blocks)
  ) {
    return undefined;
  }
  for (const block of content.blocks) {
    const response = block as Partial<ToolResponseLike> | null;
    if (
      response !== null &&
      response.type === 'tool_response' &&
      response.callId === callId
    ) {
      return displayBodyFor(response.result);
    }
  }
  return undefined;
}

/**
 * Full-body display form, matching what the uncapped replay path
 * (`safeToolResultToString`) would have rendered: strings verbatim,
 * everything else pretty-printed JSON.
 */
function displayBodyFor(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
