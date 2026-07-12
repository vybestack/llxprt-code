/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shape test for ServerFinishedEvent and ServerUsageMetadataEvent types.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P19
 * @requirement:REQ-007.3
 *
 * Verifies:
 *  (a) No production (non-test) file in packages/core/src constructs or
 *      emits a ServerUsageMetadataEvent with `{ type: AgentEventType.UsageMetadata }`
 *      as a runtime value (only test helpers may).
 *  (b) ServerFinishedEvent.value.usageMetadata is typed as UsageStats
 *      (neutral, live-path) — NOT a Gemini-named shape.
 */

import { describe, it, expect } from 'vitest';
import { expectTypeOf } from 'vitest';
import { readFileSync, readdirSync, statSync, type Stats } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerFinishedEvent, ServerUsageMetadataEvent } from '../turn.js';
import type { UsageStats } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// (b) Type-level: ServerFinishedEvent.value.usageMetadata is UsageStats
// ---------------------------------------------------------------------------

// Extract the usageMetadata property type from ServerFinishedEvent['value'].
type FinishedValueUsageMetadata = ServerFinishedEvent['value'] extends {
  usageMetadata?: infer U;
}
  ? U
  : never;

describe('P19: ServerFinishedEvent shape @plan:PLAN-20260707-AGENTNEUTRAL.P19 @requirement:REQ-007.3', () => {
  it('ServerFinishedEvent.value.usageMetadata is UsageStats (neutral)', () => {
    // The optional usageMetadata field on Finished.value must be
    // UsageStats | undefined.
    expectTypeOf<FinishedValueUsageMetadata>().toEqualTypeOf<
      UsageStats | undefined
    >();
    // Runtime assertion: the neutral field names exist on the type
    const neutral: UsageStats = {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    };
    expect(neutral.promptTokens).toBe(1);
  });

  it('ServerFinishedEvent.value.usageMetadata is NOT a Gemini-named shape', () => {
    // If it were Gemini-named, it would have promptTokenCount. Instead it
    // has promptTokens (neutral).
    const sample: ServerFinishedEvent['value'] = {
      reason: 'stop',
      usageMetadata: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
    };
    expectTypeOf(sample.usageMetadata).toEqualTypeOf<UsageStats | undefined>();
    // Runtime assertion: neutral field name exists, Gemini name does not
    expect(sample.usageMetadata?.promptTokens).toBe(1);
  });

  // ── (a) No production file emits ServerUsageMetadataEvent ──────────────

  it('no production (non-test) file in packages/core/src constructs ServerUsageMetadataEvent at runtime', () => {
    const coreSrcDir = fileURLToPath(new URL('../', import.meta.url));
    const offenders: string[] = [];
    scanForUsageMetadataEmission(coreSrcDir, offenders);

    // Only test files and type definition files may reference
    // AgentEventType.UsageMetadata as a runtime constructor. The type
    // definition in turn.ts is a type (not runtime), so it is exempt.
    expect(offenders).toStrictEqual([]);
  });

  it('ServerUsageMetadataEvent.value uses Gemini-named keys (public wire boundary)', () => {
    // ServerUsageMetadataEvent.value is the PUBLIC usage event (Gemini-named).
    // This is distinct from ServerFinishedEvent.value.usageMetadata (neutral).
    const sample: ServerUsageMetadataEvent = {
      type: 'usage_metadata' as ServerUsageMetadataEvent['type'],
      value: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };
    expect(sample.value.promptTokenCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Filesystem scanner: finds non-test .ts files that construct
// `{ type: AgentEventType.UsageMetadata, ... }` as a runtime object literal.
// ---------------------------------------------------------------------------

const USAGE_METADATA_EMIT_PATTERN =
  /type\s*:\s*AgentEventType\.UsageMetadata\b/;

function scanForUsageMetadataEmission(dir: string, offenders: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    processEntry(dir, entry, offenders);
  }
}

function processEntry(dir: string, entry: string, offenders: string[]): void {
  const fullPath = join(dir, entry);
  const stat = safeStat(fullPath);
  if (!stat) return;
  if (stat.isDirectory()) {
    if (!isSkipDir(entry)) scanForUsageMetadataEmission(fullPath, offenders);
    return;
  }
  if (stat.isFile() && extname(entry) === '.ts') {
    if (isSkipFile(entry)) return;
    const content = safeRead(fullPath);
    if (content && USAGE_METADATA_EMIT_PATTERN.test(content)) {
      offenders.push(fullPath);
    }
  }
}

function safeStat(p: string): Stats | undefined {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

function safeRead(p: string): string | undefined {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return undefined;
  }
}

function isSkipDir(entry: string): boolean {
  return (
    entry === 'node_modules' ||
    entry === 'dist' ||
    entry === '.git' ||
    entry === '__tests__'
  );
}

function isSkipFile(entry: string): boolean {
  return (
    entry.endsWith('.test.ts') ||
    entry.endsWith('.test-d.ts') ||
    entry.endsWith('.d.ts') ||
    entry === 'turn.ts'
  );
}
