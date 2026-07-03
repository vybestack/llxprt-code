/**
 * @plan PLAN-20260629-ISSUE2285.P03
 * @plan PLAN-20260629-ISSUE2285.P05
 * @requirement REQ-002
 * @pseudocode api-surface-guard.md lines 120-240
 */

/**
 * Declaration-aware API-surface guard test (P05 ENFORCEMENT MODE).
 *
 * This test does NOT shell out to a build from within its lifecycle. It reads
 * a JSON surface report emitted by the standalone `lint:agents-api-surface`
 * script (which builds declarations via an isolated temp tsconfig — mechanism
 * B1a — and writes the report to the gitignored cache path
 * `node_modules/.cache/agents-api-surface/report.json`). If the report is
 * absent, the test FAILS CLOSED (it never silently skips): in CI (`CI=true`)
 * it fails with an instruction to run `npm run lint:agents-api-surface`; the
 * only local skip path is `LLXPRT_API_SURFACE_SKIP=1` when the report is
 * absent; it suppresses that local fail-closed error via `describe.skipIf`
 * without skipping an already-generated report.
 *
 * P05 enforcement mode: the deny assertions enforce ABSENCE of the denied
 * internal names (`AgentClient`, `CoreToolScheduler`, `AgenticLoop`) after
 * depollution. P03 characterization mode proved the guard WOULD detect the
 * leak; P05 removed the re-export so the assertions now enforce absence.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseExportedNames,
  DENIED_INTERNAL_NAMES,
  loadExpectedSurface,
  API_SURFACE_REPORT_PATH,
} from '../apiSurfaceParser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SNAPSHOT_PATH = join(__dirname, 'expected-root-surface.json');

const REPORT_EXISTS = existsSync(API_SURFACE_REPORT_PATH);
const IN_CI = process.env.CI === 'true';
// Honored only outside CI; in CI the skip env var is ignored so the suite
// fail-closes if the API-surface report is absent.
const LOCAL_SKIP_REQUESTED =
  process.env.LLXPRT_API_SURFACE_SKIP === '1' && !IN_CI;
const SKIP_SUITE = REPORT_EXISTS === false && LOCAL_SKIP_REQUESTED;

function reportMissingError(): Error {
  const where = IN_CI ? 'CI' : 'local';
  return new Error(
    `[${where}] API-surface report not found at ${API_SURFACE_REPORT_PATH}. ` +
      'Run `npm run lint:agents-api-surface` first to build declarations and emit the report.',
  );
}

function hasErrorCode(err: unknown): err is { code: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

function readReportText(): string {
  if (REPORT_EXISTS === false) {
    throw reportMissingError();
  }
  try {
    return readFileSync(API_SURFACE_REPORT_PATH, 'utf8');
  } catch (err) {
    if (hasErrorCode(err) && err.code === 'ENOENT') {
      throw reportMissingError();
    }
    throw new Error(
      `Failed to read API-surface report at ${API_SURFACE_REPORT_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function readReport(): string[] {
  const reportText = readReportText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(reportText);
  } catch (err) {
    throw new Error(
      `Failed to parse API-surface report JSON at ${API_SURFACE_REPORT_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string')
  ) {
    throw new Error(
      `API-surface report at ${API_SURFACE_REPORT_PATH} is malformed: expected a JSON array of strings.`,
    );
  }
  return parsed;
}

describe.skipIf(SKIP_SUITE)(
  'P03 REQ-002: agents root API-surface guard (declaration-aware)',
  () => {
    it('preflight: expected-root-surface.json snapshot is readable at its path', () => {
      expect(existsSync(SNAPSHOT_PATH)).toBe(true);
      const snapshot = loadExpectedSurface(SNAPSHOT_PATH);
      expect(snapshot.size).toBeGreaterThan(0);
    });

    it('reads the JSON surface report emitted by lint:agents-api-surface', () => {
      const report = readReport();
      expect(report).toContain('Agent');
    });

    it('deny enforcement: denied internal names are absent after depollution (P05)', () => {
      const report = readReport();
      const exported = new Set(report);
      // Sanity: the deny list must include the three internal symbols this
      // guard enforces. If the constant is accidentally narrowed (e.g. one
      // name dropped), the iterate loop below would pass vacuously.
      expect(DENIED_INTERNAL_NAMES.has('AgentClient')).toBe(true);
      expect(DENIED_INTERNAL_NAMES.has('CoreToolScheduler')).toBe(true);
      expect(DENIED_INTERNAL_NAMES.has('AgenticLoop')).toBe(true);
      for (const denied of DENIED_INTERNAL_NAMES) {
        expect(exported.has(denied)).toBe(false);
      }
    });

    it('snapshot comparison: current report matches the expected-root-surface snapshot', () => {
      const report = readReport();
      const exported = new Set(report);
      const expected: Set<string> = loadExpectedSurface(SNAPSHOT_PATH);
      const added = [...exported].filter((name) => !expected.has(name));
      const removed = [...expected].filter((name) => !exported.has(name));
      expect(added).toStrictEqual([]);
      expect(removed).toStrictEqual([]);
    });

    it('report includes AgenticLoopMessage (type-only re-export captured by the parser)', () => {
      const report = readReport();
      const exported = new Set(report);
      expect(exported.has('AgenticLoopMessage')).toBe(true);
    });

    it('report reflects recursive export-star resolution from emitted declarations', () => {
      const report = readReport();
      const exportedNames = new Set(report);
      expect(exportedNames.has('Agent')).toBe(true);
      expect(exportedNames.size).toBeGreaterThan(50);
    });

    it('named-export alias proof: parseExportedNames records the EXPORTED alias name for `export { X as Y }` (local and re-exported)', () => {
      const fixtureIndex = join(
        __dirname,
        'fixtures',
        'alias-surface',
        'index.d.ts',
      );
      expect(existsSync(fixtureIndex)).toBe(true);
      const names = parseExportedNames(fixtureIndex);
      expect(names.has('PublicAlias')).toBe(true);
      expect(names.has('PublicType')).toBe(true);
      expect(names.has('AlsoPublic')).toBe(true);
      expect(names.has('InternalType')).toBe(true);
      expect(names.has('Hidden')).toBe(false);
      expect(names.has('Value')).toBe(false);
    });
  },
);
