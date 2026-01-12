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

import crypto from 'node:crypto';

export interface CanonicalToolIdInput {
  providerName?: string;
  rawId?: string;
  toolName?: string;
  turnKey: string;
  callIndex: number;
}

const CANONICAL_PREFIX = 'hist_tool_';
const CANONICAL_LENGTH = 24;

function normalizeRawId(rawId: string | undefined): string | undefined {
  if (!rawId) {
    return undefined;
  }

  if (rawId.startsWith(CANONICAL_PREFIX)) {
    return rawId.substring(CANONICAL_PREFIX.length);
  }

  let candidate = rawId;
  let didStrip = true;

  while (didStrip) {
    didStrip = false;

    if (candidate.startsWith('call_')) {
      candidate = candidate.substring('call_'.length);
      didStrip = true;
      continue;
    }

    if (candidate.startsWith('toolu_')) {
      candidate = candidate.substring('toolu_'.length);
      didStrip = true;
      continue;
    }

    if (candidate.startsWith('call') && !candidate.startsWith('call_')) {
      const suffix = candidate.substring('call'.length);
      const looksLikeToken =
        suffix.length >= 8 && /^[a-zA-Z0-9]+$/.test(suffix);
      if (looksLikeToken) {
        candidate = suffix;
        didStrip = true;
        continue;
      }
    }
  }

  return candidate || undefined;
}

function buildCanonicalToolId(input: CanonicalToolIdInput): string {
  const rawId = input.rawId ?? '';
  if (rawId.startsWith(CANONICAL_PREFIX)) {
    return rawId;
  }

  const normalizedRawId = normalizeRawId(input.rawId);
  const seedParts = [
    input.providerName ?? '',
    normalizedRawId ?? '',
    input.toolName ?? '',
  ];

  if (!normalizedRawId) {
    seedParts.push(input.turnKey, String(input.callIndex));
  }

  const seed = seedParts.join('|');
  const hash = crypto.createHash('sha256').update(seed).digest('base64url');
  return `${CANONICAL_PREFIX}${hash.slice(0, CANONICAL_LENGTH)}`;
}

export function canonicalizeToolCallId(input: CanonicalToolIdInput): string {
  return buildCanonicalToolId(input);
}

export function canonicalizeToolResponseId(
  input: CanonicalToolIdInput,
): string {
  return buildCanonicalToolId(input);
}
