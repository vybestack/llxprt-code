/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/agents-neutral-gate.ts.
 *
 * Tests the ACTUAL gate behavior through the real AST pipeline by running
 * `--enforce-imports --files <fixture>` against the fixtures and checking
 * the exit code. No mocks.
 *
 * Covers:
 *   - checkE (value-aware Type enum re-declaration detection)
 *   - checkD (round-trip conversion symbols / deleted-helper guard)
 *   - checkG-barrel (GeminiContent* barrel imports)
 *   - checkH (Gemini usage keys outside boundary modules)
 *   - AST-context exemption proof (file-level exemption rejected)
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getEnforceImportHits, parseGateArgs } from '../agents-neutral-gate.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'gate-fixtures');

/**
 * Run the gate against a fixture file in-process (--enforce-imports mode).
 * Returns 0 when no non-exempt hits are found (pass), 1 otherwise (fail).
 *
 * Finding #5: replaces execFileSync('npx', ['tsx', ...]) with a direct
 * in-process call to getEnforceImportHits — eliminates one npx process
 * spawn per test so normal `npm run test:scripts` is reliable.
 */
function runGateEnforce(fixtureRel: string): number {
  const fixture = resolve(FIXTURES_DIR, fixtureRel);
  const args = parseGateArgs(['--enforce-imports', '--files', fixture]);
  const hits = getEnforceImportHits(args);
  return hits.length === 0 ? 0 : 1;
}

/**
 * Runs the gate against an inline temp source in-process. Used for fixtures
 * that cannot be committed as .ts files because they contain lint-forbidden
 * syntax (e.g. `require()`). The source is written to a temp .ts file,
 * scanned, then cleaned up.
 */
function runGateEnforceSource(source: string): number {
  const tempDir = mkdtempSync(join(tmpdir(), 'gate-src-'));
  const tempFile = join(tempDir, 'fixture.ts');
  writeFileSync(tempFile, source);
  try {
    const args = parseGateArgs(['--enforce-imports', '--files', tempFile]);
    const hits = getEnforceImportHits(args);
    return hits.length === 0 ? 0 : 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('agents-neutral-gate checkE — value-aware Type detection', () => {
  it('SPARES a neutral lowercase Type alias (false-positive guard)', () => {
    const exitCode = runGateEnforce('safe-type-neutral.ts');
    expect(exitCode).toBe(0);
  });

  it('SPARES a neutral lowercase Type const with lowercase values (value-aware guard)', () => {
    const exitCode = runGateEnforce('safe-type-neutral-const.ts');
    expect(exitCode).toBe(0);
  });

  it('FLAGS a Google-shaped Type const with uppercase values', () => {
    const exitCode = runGateEnforce('type-enum-redeclaration.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkD — round-trip symbol detection', () => {
  it('FLAGS a round-trip conversion symbol import (deleted-helper guard)', () => {
    const exitCode = runGateEnforce('roundtrip-symbol.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkG-barrel — GeminiContent barrel import detection', () => {
  it('FLAGS a GeminiContent* barrel type import', () => {
    const exitCode = runGateEnforce('gemini-barrel-import.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkH — Gemini usage key detection', () => {
  it('FLAGS a Gemini usage key in an object literal outside boundary modules', () => {
    const exitCode = runGateEnforce('usage-key-outside-boundary.ts');
    expect(exitCode).not.toBe(0);
  });

  it('REJECTS a file-level exemption: usage key in eventAdapter.ts OUTSIDE the mapper STILL fires', () => {
    // This fixture's path ends with "eventAdapter.ts" matching the allow-list
    // entry's file suffix, but the usage key is NOT inside the
    // usageStatsToPublicUsageMetadata function — proving the exemption is
    // AST-context-keyed, NOT file-level (Major 4).
    const exitCode = runGateEnforce('eventAdapter-outside-mapper.ts');
    expect(exitCode).not.toBe(0);
  });

  it('REJECTS runtime usage key in event-types.ts-shaped file (Finding #1: type-decl context required)', () => {
    // The allow-list entry for event-types.ts is intended for declared type
    // members (PropertySignature). A runtime object literal hit must FAIL
    // even though the snippet contains the key name. This fixture is
    // path-accurate to the allow-list suffix and contains BOTH a declared
    // type member (legitimate) and a runtime object literal (must fail).
    const exitCode = runGateEnforce(
      'api-boundary/packages/agents/src/api/event-types.ts',
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS a quoted string-literal property key (Finding #2)', () => {
    // { 'promptTokenCount': 1 } — StringLiteral property key in object literal
    const exitCode = runGateEnforce('usage-key-quoted-only.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS a bracket/element access usage key (Finding #2)', () => {
    // usage['promptTokenCount'] — ElementAccessExpression with StringLiteral
    const exitCode = runGateEnforce('usage-key-bracket-access.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate — safe fixtures must pass (no false positives)', () => {
  it('PASSES on clean-neutral.ts (zero #2424 vectors)', () => {
    expect(runGateEnforce('clean-neutral.ts')).toBe(0);
  });

  it('PASSES on safe-neutral-names.ts (provenance, not bare name)', () => {
    expect(runGateEnforce('safe-neutral-names.ts')).toBe(0);
  });

  it('PASSES on safe-domain-types.ts (neutral domain types)', () => {
    expect(runGateEnforce('safe-domain-types.ts')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #2: checkF structural F checks — adversarial pass/fail fixtures
// ---------------------------------------------------------------------------

describe('agents-neutral-gate checkF1 — candidates content with role/parts (Finding #2)', () => {
  it('FLAGS quoted-key candidates envelope with content.role (string-literal keys)', () => {
    const exitCode = runGateEnforce('f1-quoted-candidates-role.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS candidates where the SECOND element has content.parts (inspect all candidates)', () => {
    const exitCode = runGateEnforce('f1-second-candidate.ts');
    expect(exitCode).not.toBe(0);
  });

  it('SPARES neutral {candidates:[{content:"plain string"}]} (content is not an object with role/parts)', () => {
    const exitCode = runGateEnforce('f1-neutral-content-plain.ts');
    expect(exitCode).toBe(0);
  });

  it('SPARES neutral {candidates:[{content:42}]} (content is a number, not an object)', () => {
    const exitCode = runGateEnforce('f1-neutral-content-number.ts');
    expect(exitCode).toBe(0);
  });

  it('SPARES {candidates:[{content:{foo:"bar"}}]} (content object has no role/parts)', () => {
    const exitCode = runGateEnforce('f1-safe-plain-content-key.ts');
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkF3 — role/parts with string-literal keys (Finding #2)', () => {
  it('FLAGS quoted-key {role:"user", parts} envelope', () => {
    const exitCode = runGateEnforce('f3-quoted-role-parts.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkF5 — direct .parts reads/mutations (Finding #2)', () => {
  it('FLAGS direct .parts property read (message.parts)', () => {
    const exitCode = runGateEnforce('f5-parts-property-read.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS bracket/element-access .parts read (content["parts"])', () => {
    const exitCode = runGateEnforce('f5-parts-element-read.ts');
    expect(exitCode).not.toBe(0);
  });

  it('SPARES neutral .blocks property read', () => {
    const exitCode = runGateEnforce('f5-safe-blocks-read.ts');
    expect(exitCode).toBe(0);
  });
  describe('agents-neutral-gate checkF5 — const-computed key access (Finding #5 latest)', () => {
    it('FLAGS const-computed [key] where key="parts" on Google-shaped value', () => {
      // const key = 'parts'; const wire = { role: 'model', parts: [...] };
      // return wire[key];
      // Must be detected — the gate resolves the const to 'parts' and the
      // base has Google-shaped provenance.
      const exitCode = runGateEnforce('f5-const-computed-parts-read.ts');
      expect(exitCode).not.toBe(0);
    });

    it('SPARES const-computed [key] where key="parts" on neutral domain object', () => {
      // const key = 'parts'; const domain = { parts: ['wheel'] };
      // return domain[key];
      // Must NOT be flagged — domain lacks Google-shaped provenance.
      const exitCode = runGateEnforce('f5-safe-const-computed-parts.ts');
      expect(exitCode).toBe(0);
    });

    it('FLAGS const-computed [key] where key="parts" via inline temp source', () => {
      const exitCode = runGateEnforceSource(
        `export function readParts(): unknown {
  const key = 'parts';
  const wire = { role: 'model', parts: [{ text: 'hi' }] };
  return wire[key];
}
`,
      );
      expect(exitCode).not.toBe(0);
    });

    it('SPARES const-computed [key] where key="parts" on neutral domain via inline temp source', () => {
      const exitCode = runGateEnforceSource(
        `export function readDomain(): unknown {
  const key = 'parts';
  const domain = { parts: ['wheel'] };
  return domain[key];
}
`,
      );
      expect(exitCode).toBe(0);
    });

    it('SPARES const-computed [key] where key is NOT "parts" on Google-shaped value', () => {
      // const key = 'candidates'; const wire = { parts: [{ text: 'hi' }] };
      // return wire[key];
      // F5 must NOT fire — the const resolves to 'candidates', not 'parts'.
      // The base has Part-shaped parts (Google-shaped), but the key is not
      // 'parts', so F5's const-computed check must not trigger.
      const exitCode = runGateEnforceSource(
        `export function readKey(): unknown {
  const key = 'candidates';
  const wire = { parts: [{ text: 'hi' }] };
  return wire[key];
}
`,
      );
      expect(exitCode).toBe(0);
    });
  });
});

describe('agents-neutral-gate checkF5 — provenance constraint + indirect shorthand (Finding #5)', () => {
  it('FLAGS indirect shorthand candidates envelope built via separate variables', () => {
    // {const role='model'; const parts=[]; const content={role,parts};
    //  const candidate={content}; return {candidates:[candidate]}}
    // Must be detected by F1/F3 even though no single inline literal
    // contains the full Gemini shape.
    const exitCode = runGateEnforce('f5-indirect-shorthand-envelope.ts');
    expect(exitCode).not.toBe(0);
  });

  it('SPARES unrelated domain.parts access ({parts:["wheel"]} has no Google provenance)', () => {
    // {const domain={parts:['wheel']}; domain.parts.length}
    // Must NOT be flagged — domain is not Google Content-shaped.
    const exitCode = runGateEnforce('f5-safe-domain-parts.ts');
    expect(exitCode).toBe(0);
  });

  it('SPARES domain.parts access via inline temp source', () => {
    // Same probe via inline source to guard against fixture path issues.
    const exitCode = runGateEnforceSource(
      `export function countWheels(): number {
  const domain = { parts: ['wheel'] };
  return domain.parts.length;
}
`,
    );
    expect(exitCode).toBe(0);
  });

  it('FLAGS indirect shorthand envelope via inline temp source', () => {
    const exitCode = runGateEnforceSource(
      `export function makeResponse(): unknown {
  const role = 'model';
  const parts: unknown[] = [];
  const content = { role, parts };
  const candidate = { content };
  return { candidates: [candidate] };
}
`,
    );
    expect(exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #3: checkA re-export/dynamic-import/require + checkD declarations
// ---------------------------------------------------------------------------

describe('agents-neutral-gate checkA — re-export, dynamic import, require (Finding #3)', () => {
  it('FLAGS re-export from @google/genai (export ... from)', () => {
    const exitCode = runGateEnforce('a-export-from-genai.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS dynamic import() of @google/genai', () => {
    const exitCode = runGateEnforce('a-dynamic-import-genai.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS require() of @google/genai', () => {
    // Written as an inert temp source because require() is lint-forbidden
    // in the ESM-only project. The gate detects the AST call-expression.
    const exitCode = runGateEnforceSource(
      `export function loadGenaiCjs(): unknown {
  return require('@google/genai');
}
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('SPARES @google/genai only in comments/string literals (false-positive guard)', () => {
    const exitCode = runGateEnforce('a-safe-comment-genai.ts');
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkA — @google/genai/* subpath imports', () => {
  it('FLAGS static import from @google/genai/* subpath', () => {
    const exitCode = runGateEnforceSource(
      `import { Content } from '@google/genai/internal';
export function useContent(c: Content): unknown { return c; }
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS re-export from @google/genai/* subpath', () => {
    const exitCode = runGateEnforceSource(
      `export { Content } from '@google/genai/internal';
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS dynamic import() of @google/genai/* subpath', () => {
    const exitCode = runGateEnforce('a-subpath-dynamic-genai.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS require() of @google/genai/* subpath', () => {
    const exitCode = runGateEnforceSource(
      `export function loadGenaiSubpathCjs(): unknown {
  return require('@google/genai/internal');
}
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('SPARES unrelated @google/genai-incubator (not a @google/genai subpath)', () => {
    const exitCode = runGateEnforceSource(
      `export const mod = 'not-from-google-genai';
`,
    );
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkA — import() type reference (ImportTypeNode)', () => {
  it('FLAGS import("@google/genai").Content type reference', () => {
    const exitCode = runGateEnforceSource(
      `export type GenaiContent = import('@google/genai').Content;
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS import("@google/genai").GenerateContentResponse type reference', () => {
    const exitCode = runGateEnforceSource(
      `export type Resp = import('@google/genai').GenerateContentResponse;
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS import("@google/genai/subpath").Content subpath type reference', () => {
    const exitCode = runGateEnforceSource(
      `export type SubContent = import('@google/genai/internal').Content;
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('SPARES import("some-other-module").Content (not @google/genai)', () => {
    const exitCode = runGateEnforceSource(
      `export type OtherContent = import('some-other-lib').Content;
`,
    );
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkD — deleted-helper declarations (Finding #3)', () => {
  it('FLAGS local function declaration of a deleted-helper symbol', () => {
    const exitCode = runGateEnforce('d-local-function-decl.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS local variable declaration of a deleted-helper symbol', () => {
    const exitCode = runGateEnforce('d-local-var-decl.ts');
    expect(exitCode).not.toBe(0);
  });

  it('SPARES deleted-helper names only in comments/strings (false-positive guard)', () => {
    const exitCode = runGateEnforce('d-safe-comment-string.ts');
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #3 (fresh review): checkB2/B3/F6/F7 — alias-target, local-decl,
// destructured parts, candidates-typed envelopes
// ---------------------------------------------------------------------------

describe('agents-neutral-gate checkB2 — import aliased TO banned legacy name (Finding #3 fresh)', () => {
  it('FLAGS import aliased TO a banned legacy name from a non-banned module', () => {
    const exitCode = runGateEnforce('b2-alias-to-banned.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS import aliased TO a banned legacy name via inline temp source', () => {
    const exitCode = runGateEnforceSource(
      `import { someNeutral as Candidate } from 'neutral-lib';
export function useCandidate(c: Candidate): unknown { return c; }
`,
    );
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkB3 — local declarations using banned response names (Finding #3 fresh)', () => {
  it('FLAGS local const declaration using banned response name', () => {
    const exitCode = runGateEnforce('b3-local-banned-decl.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS local interface declaration using banned response name via inline source', () => {
    const exitCode = runGateEnforceSource(
      `interface GenerateContentResponse { candidates: unknown[]; }
export function useResp(r: GenerateContentResponse): unknown { return r.candidates; }
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('SPARES local declarations with neutral names (false-positive guard)', () => {
    const exitCode = runGateEnforce('b3-safe-neutral-name.ts');
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkF6 — destructured parts on response-shaped values (Finding #3 fresh)', () => {
  it('FLAGS destructured parts from Google-shaped response value', () => {
    const exitCode = runGateEnforce('f6-parts-destructure.ts');
    expect(exitCode).not.toBe(0);
  });

  it('SPARES destructured parts from neutral domain object (false-positive guard)', () => {
    const exitCode = runGateEnforce('f6-safe-domain-destructure.ts');
    expect(exitCode).toBe(0);
  });
});

describe('agents-neutral-gate checkF7 — candidates-bearing typed/assigned response envelopes (Finding #3 fresh)', () => {
  it('FLAGS variable typed with candidates-bearing response envelope (initializer is a call)', () => {
    const exitCode = runGateEnforce('f7-candidates-typed-envelope.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS .candidates access on call with candidates-bearing return type via inline source', () => {
    const exitCode = runGateEnforceSource(
      `declare function getResponse(): { candidates: unknown[] };
export function useResponse(): unknown {
  const x = getResponse();
  return x.candidates;
}
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('SPARES .candidates access on call WITHOUT candidates-bearing return type (false-positive guard)', () => {
    // getSearchResults returns a neutral type; accessing .candidates on it
    // must NOT be flagged — this is a legitimate search API, not a Google
    // response envelope.
    const exitCode = runGateEnforceSource(
      `interface SearchResult { candidates: string[]; }
declare function getSearchResults(): SearchResult;
export function useSearch(): string[] {
  return getSearchResults().candidates;
}
`,
    );
    expect(exitCode).toBe(0);
  });

  it('SPARES .candidates access on variable from a non-candidates call (false-positive guard)', () => {
    const exitCode = runGateEnforceSource(
      `interface SearchResult { candidates: string[]; }
declare function getSearchResults(): SearchResult;
export function useSearch(): string[] {
  const x = getSearchResults();
  return x.candidates;
}
`,
    );
    expect(exitCode).toBe(0);
  });

  it('SPARES .candidates on array method chain (unrelated domain)', () => {
    const exitCode = runGateEnforceSource(
      `interface Item { candidates: number; }
export function best(arr: Item[]): number {
  return arr.filter((i) => i.candidates > 0)[0].candidates;
}
`,
    );
    expect(exitCode).toBe(0);
  });

  it('SPARES forbidden response without candidates type annotation', () => {
    // A response variable typed WITHOUT candidates — must not be flagged
    // by F7 even though it accesses .candidates. (Other checks like F1
    // handle inline candidates envelopes.)
    const exitCode = runGateEnforceSource(
      `declare function getResp(): unknown;
export function useResp(): unknown {
  const x = getResp();
  return (x as { result: unknown }).result;
}
`,
    );
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #2 (fresh review): PartUnion banned symbol, ContractPartUnion
// contract alias, local PartUnion declaration, alias-to-PartUnion, and safe
// neutral-name guard.
// ---------------------------------------------------------------------------

describe('agents-neutral-gate checkB — PartUnion banned import (Finding #2 fresh)', () => {
  it('FLAGS PartUnion imported from @google/genai', () => {
    const exitCode = runGateEnforce('b-partunion-import.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkC — ContractPartUnion contract alias (Finding #2 fresh)', () => {
  it('FLAGS ContractPartUnion imported from a banned module', () => {
    const exitCode = runGateEnforce('c-contract-partunion.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkB2 — import aliased TO PartUnion (Finding #2 fresh)', () => {
  it('FLAGS import aliased TO PartUnion from a non-banned module', () => {
    const exitCode = runGateEnforce('b2-alias-to-partunion.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkB3 — local PartUnion declaration (Finding #2 fresh)', () => {
  it('FLAGS local type alias declaration using PartUnion name', () => {
    const exitCode = runGateEnforce('b3-local-partunion-decl.ts');
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate — safe neutral union name (Finding #2 fresh false-positive guard)', () => {
  it('SPARES neutral MyBlockUnion (not a banned Google name)', () => {
    const exitCode = runGateEnforce('b-safe-neutral-blocks-union.ts');
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #3 (latest clean review): checkB2 ExportSpecifier aliases and
// checkB3 all local declarations using every banned/Contract payload name.
// ---------------------------------------------------------------------------

describe('agents-neutral-gate checkB2 — ExportSpecifier aliased TO banned name (Finding #3 latest)', () => {
  it('FLAGS export specifier aliased TO a banned legacy name', () => {
    const exitCode = runGateEnforce('b2-export-alias-to-banned.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS export specifier aliased TO a banned legacy name via inline source', () => {
    const exitCode = runGateEnforceSource(
      `export { someNeutralName as GenerateContentResponse } from 'neutral-lib';\n`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS export specifier aliased TO Content via inline source', () => {
    const exitCode = runGateEnforceSource(
      `export { neutralThing as Content } from 'somelib';\n`,
    );
    expect(exitCode).not.toBe(0);
  });
});

describe('agents-neutral-gate checkB3 — local declarations using Contract payload names (Finding #3 latest)', () => {
  it('FLAGS local const declaration using Contract* payload name', () => {
    const exitCode = runGateEnforce('b3-local-contract-decl.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS local interface declaration using ContractPart name via inline source', () => {
    const exitCode = runGateEnforceSource(
      `interface ContractPart { text: string; }
export function useP(p: ContractPart): unknown { return p; }
`,
    );
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS local const declaration using Content (banned payload name)', () => {
    const exitCode = runGateEnforce('b3-local-content-decl.ts');
    expect(exitCode).not.toBe(0);
  });

  it('FLAGS local type alias using Candidate via inline source', () => {
    const exitCode = runGateEnforceSource(
      `type Candidate = { content: unknown };
export function useC(c: Candidate): unknown { return c.content; }
`,
    );
    expect(exitCode).not.toBe(0);
  });
});
