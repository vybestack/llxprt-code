/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/agents-neutral-test-gate.ts provenance-aware
 * boundary detection.
 *
 * These tests prove that the test gate correctly distinguishes:
 *   1. Converter boundary fixtures (passed to toIContent,
 *      extractSystemInstructionText, etc.) — EXEMPT
 *   2. Legacy compat characterization (LegacyContent/LegacyPart types) — EXEMPT
 *   3. Legacy rejection tests (describe/it with "malformed"/"rejects") — EXEMPT
 *   4. Unrelated adversarial fixtures in the SAME file — NOT EXEMPT
 *
 * Uses real temp files scanned through the actual AST pipeline. No mocks.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.3
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findStructuralOffenders } from '../agents-neutral-test-gate.ts';

/**
 * Scans an inline temp test file for structural offenses through the real
 * gate pipeline. Returns the list of offenses (empty = pass).
 */
function scanForOffenses(
  source: string,
): ReturnType<typeof findStructuralOffenders> {
  const tempDir = mkdtempSync(join(tmpdir(), 'test-gate-'));
  const tempFile = join(tempDir, 'fixture.test.ts');
  writeFileSync(tempFile, source);
  try {
    return findStructuralOffenders([tempFile], tempDir, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('agents-neutral-test-gate — converter boundary provenance', () => {
  it('EXEMPTS role+parts fixture passed directly to extractSystemInstructionText', () => {
    const source = `
import { extractSystemInstructionText } from './helper.js';
it('test', () => {
  const content = { role: 'system', parts: [{ text: 'hello' }] };
  expect(extractSystemInstructionText(content as unknown)).toBe('hello');
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });

  it('EXEMPTS functionCall fixture passed directly to convertToFunctionResponse', () => {
    const source = `
import { convertToFunctionResponse } from './helper.js';
it('test', () => {
  const llmContent = { functionCall: { name: 'test', args: {} } };
  const result = convertToFunctionResponse('tool', 'id', llmContent);
  expect(result).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });

  it('EXEMPTS functionResponse fixture passed directly to normalizeToolInteractionInput', () => {
    const source = `
import { normalizeToolInteractionInput } from './helper.js';
it('test', () => {
  const parts = [{ functionResponse: { id: 'c1', name: 'read', response: {} } }];
  const result = normalizeToolInteractionInput(parts);
  expect(result).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });

  it('EXEMPTS role+parts fixture passed to ContentConverters.toIContent (property-access form)', () => {
    const source = `
import { ContentConverters } from './helper.js';
it('test', () => {
  const content = { role: 'model', parts: [{ text: 'hi' }] };
  const result = ContentConverters.toIContent(content);
  expect(result).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });
});

describe('agents-neutral-test-gate — legacy compat characterization provenance', () => {
  it('EXEMPTS role+parts fixture in a file declaring LegacyContent/LegacyPart types', () => {
    const source = `
interface LegacyPart { text?: string; functionCall?: unknown; }
interface LegacyContent { role: string; parts: LegacyPart[]; }
it('test', () => {
  const content: LegacyContent = {
    role: 'model',
    parts: [{ text: 'hello' }],
  };
  expect(content).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });

  it('EXEMPTS functionCall fixture in a file declaring LegacyPart type', () => {
    const source = `
interface LegacyPart { functionCall?: { name: string }; }
it('test', () => {
  const part: LegacyPart = { functionCall: { name: 'test_tool' } };
  expect(part).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(0);
  });
});

describe('agents-neutral-test-gate — legacy rejection via central allow-list (keyword exemption removed)', () => {
  it('EXEMPTS role+parts fixture when central allow-list matches the test-block label', () => {
    // The keyword auto-exemption was removed. Now the ONLY way to exempt
    // legacy rejection fixtures is via the central allow-list with an exact
    // test-block label context pattern.
    const source = `
describe('rejects malformed legacy entries', () => {
  it('test', () => {
    const bad = { role: 'model', parts: [{ text: 'legacy' }] };
    expect(bad).toBeDefined();
  });
});
`;
    const allowlist = [
      {
        file: 'fixture.test.ts',
        kind: 'test-structural-allow',
        contextPattern: 'rejects malformed legacy entries',
      },
    ];
    const tempDir = mkdtempSync(join(tmpdir(), 'test-gate-'));
    const tempFile = join(tempDir, 'fixture.test.ts');
    writeFileSync(tempFile, source);
    try {
      const offenses = findStructuralOffenders([tempFile], tempDir, allowlist);
      expect(offenses).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('FLAGS functionResponse fixture when NO allow-list entry matches (keyword exemption gone)', () => {
    // Without keyword auto-exemption AND without a matching allow-list
    // entry, the fixture is correctly FLAGGED.
    const source = `
it('returns undefined for invalid functionResponse input', () => {
  const bad = { functionResponse: { name: 'test', response: {} } };
  expect(bad).toBeDefined();
});
`;
    expect(scanForOffenses(source)).toHaveLength(1);
  });
});

describe('agents-neutral-test-gate — adversarial fixtures still FAIL', () => {
  it('FLAGS standalone role+parts fixture NOT in any boundary context', () => {
    const source = `
it('test', () => {
  const history = [
    { role: 'user', parts: [{ text: 'hello' }] },
    { role: 'model', parts: [{ text: 'hi' }] },
  ];
  expect(history).toHaveLength(2);
});
`;
    const offenses = scanForOffenses(source);
    expect(offenses.length).toBeGreaterThanOrEqual(2);
    expect(offenses.every((o) => o.kind === 'role-parts-envelope')).toBe(true);
  });

  it('FLAGS standalone functionCall fixture NOT in any boundary context', () => {
    const source = `
it('test', () => {
  const part = { functionCall: { name: 'test', args: {} } };
  expect(part).toBeDefined();
});
`;
    const offenses = scanForOffenses(source);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].kind).toBe('function-call-part');
  });

  it('FLAGS standalone functionResponse fixture NOT in any boundary context', () => {
    const source = `
it('test', () => {
  const part = { functionResponse: { name: 'read', response: {} } };
  expect(part).toBeDefined();
});
`;
    const offenses = scanForOffenses(source);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].kind).toBe('function-response-part');
  });
});

describe('agents-neutral-test-gate — unrelated fixture in exempt boundary file FAILS', () => {
  it('FLAGS unrelated role+parts fixture in a file that ALSO has a converter boundary call', () => {
    // The converter boundary exempts the `content` variable (passed to
    // extractSystemInstructionText), but the `unrelated` fixture is NOT
    // passed to any converter — it must still FAIL.
    const source = `
import { extractSystemInstructionText } from './helper.js';
it('test', () => {
  const content = { role: 'system', parts: [{ text: 'hello' }] };
  expect(extractSystemInstructionText(content as unknown)).toBe('hello');

  // This unrelated fixture must STILL be flagged
  const unrelated = { role: 'user', parts: [{ text: 'unrelated' }] };
  expect(unrelated).toBeDefined();
});
`;
    const offenses = scanForOffenses(source);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].snippet).toContain('unrelated');
  });

  it('FLAGS unrelated role+parts fixture in a file that declares LegacyContent type', () => {
    // The LegacyContent declaration exempts fixtures using the legacy types,
    // but an unrelated fixture in a non-legacy context must still FAIL.
    const source = `
interface LegacyContent { role: string; parts: unknown[]; }
it('legacy test', () => {
  const content: LegacyContent = { role: 'model', parts: [] };
  expect(content).toBeDefined();
});

it('unrelated test', () => {
  // This is NOT inside a legacy compat context — must fail
  const bad = { role: 'user', parts: [{ text: 'not legacy' }] };
  expect(bad).toBeDefined();
});
`;
    const offenses = scanForOffenses(source);
    // The unrelated fixture must be flagged. The legacy one should be exempt.
    expect(offenses.length).toBeGreaterThanOrEqual(1);
    expect(offenses.some((o) => o.snippet.includes('not legacy'))).toBe(true);
  });

  it('FLAGS functionCall fixture inside a keyword-labeled block when NO allow-list matches', () => {
    // Keyword auto-exemption was removed. Without a matching allow-list entry,
    // BOTH the rejection-block fixture AND the normal-block fixture are flagged.
    const source = `
describe('rejects malformed entries', () => {
  it('test', () => {
    const bad = { functionResponse: { name: 'x', response: {} } };
    expect(bad).toBeDefined();
  });
});

it('normal test', () => {
  // NOT in a rejection block — must fail
  const call = { functionCall: { name: 'tool', args: {} } };
  expect(call).toBeDefined();
});
`;
    const offenses = scanForOffenses(source);
    // Both the functionResponse (in rejection block) and functionCall (normal)
    // are flagged because keyword auto-exemption is removed.
    expect(offenses).toHaveLength(2);
    expect(offenses.some((o) => o.kind === 'function-call-part')).toBe(true);
    expect(offenses.some((o) => o.kind === 'function-response-part')).toBe(
      true,
    );
  });
});
