/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3567: extend CodeQL coverage for non-PR events.
 *
 * A behavioral contract against the real files on disk (not mocks): the two
 * CodeQL config files, the init step's config-file routing expression in
 * `.github/workflows/ci.yml`, and the local mechanism-class query pack under
 * `.github/codeql/queries`. Non-PR events (push, workflow_dispatch) must
 * route to the security-and-quality suite plus the local pack, while the PR
 * path (pull_request, merge_group) must keep the default security suite
 * exactly as pre-#3567 (PR config has neither `queries` nor `packs`). The
 * queries themselves must stay mechanism-class: no repo-internal paths or
 * identifiers may appear in their text.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { WorkflowDocument, WorkflowJob } from './typed-test-helpers.ts';
import {
  asRecord,
  asString,
  parseWorkflowYaml,
  stepWith,
  workflowJob,
} from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';

const ROOT = resolve(import.meta.dirname, '../..');

const FULL_CONFIG_PATH = '.github/codeql/codeql-config.yml';
const PR_CONFIG_PATH = '.github/codeql/codeql-config-pr.yml';
const QUERIES_DIR = '.github/codeql/queries';

/**
 * The exact init-step expression from ci.yml. Asserted verbatim so any edit
 * to the routing must consciously update this contract.
 */
const CONFIG_FILE_EXPRESSION =
  "${{ (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && './.github/codeql/codeql-config.yml' || './.github/codeql/codeql-config-pr.yml' }}";

/** The three mechanism-class queries the pack must contain (and no others). */
const EXPECTED_QUERY_IDS: Record<string, string> = {
  'cancellation-propagation.ql':
    'js/mechanism/cancellation-signal-not-propagated',
  'cleanup-symmetry-on-error-paths.ql':
    'js/mechanism/cleanup-missing-on-error-path',
  'unbounded-accumulation.ql': 'js/mechanism/unbounded-accumulation',
};

/** Repo-internal strings that must never appear in a query (overfit gate). */
const FORBIDDEN_QUERY_SUBSTRINGS = ['packages/', 'src/', 'vybestack'];
const FORBIDDEN_QUERY_EXTENSION_PATTERN =
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)\b/;

/**
 * Matches the routing expression's shape:
 * `${{ (github.event_name == 'A' || github.event_name == 'B') && 'P' || 'Q' }}`
 */
const ROUTING_EXPRESSION_PATTERN =
  /^\$\{\{ \(github\.event_name == '([^']+)' \|\| github\.event_name == '([^']+)'\) && '([^']+)' \|\| '([^']+)' \}\}$/;

interface ConfigFileRouting {
  readonly fullConfigEvents: readonly string[];
  readonly fullConfigPath: string;
  readonly prConfigPath: string;
}

/** Parses a YAML document into a record, failing fast on non-mapping docs. */
function parseYamlRecord(
  source: string,
  label: string,
): Record<string, unknown> {
  const loaded = yaml.load(source);
  if (loaded === null || loaded === undefined) {
    throw new Error(`${label} should parse to a YAML mapping`);
  }
  return asRecord(loaded);
}

/** Extracts the routing operands from the literal expression text. */
function extractRouting(expression: string): ConfigFileRouting {
  const match = ROUTING_EXPRESSION_PATTERN.exec(expression);
  if (match === null) {
    throw new Error(
      `config-file expression should match the expected routing shape: ${expression}`,
    );
  }
  return {
    fullConfigEvents: [match[1] ?? '', match[2] ?? ''],
    fullConfigPath: match[3] ?? '',
    prConfigPath: match[4] ?? '',
  };
}

/**
 * Simulates GitHub Actions truthiness for the strings that appear here:
 * a non-empty string is truthy.
 */
function githubTruthy(value: string): boolean {
  return value !== '';
}

/**
 * Evaluates the expression's `(A || B) && P || Q` semantics (`&&` binds
 * tighter than `||`) for a given event name, mirroring how the runner
 * resolves the config-file input. The `githubTruthy` wrapper applies only
 * to the operand strings, where GitHub treats any non-empty string as
 * truthy; the comparison itself already yields a boolean.
 */
function evaluateRouting(routing: ConfigFileRouting, event: string): string {
  const routesToFull =
    event === routing.fullConfigEvents[0] ||
    event === routing.fullConfigEvents[1];
  return routesToFull && githubTruthy(routing.fullConfigPath)
    ? routing.fullConfigPath
    : routing.prConfigPath;
}

describe('Issue #3567: CodeQL security-and-quality suite plus mechanism query pack routing', () => {
  let workflow: WorkflowDocument;
  let codeql: WorkflowJob;
  let configFileInput: string;
  let routing: ConfigFileRouting;

  beforeAll(() => {
    workflow = parseWorkflowYaml(readRootFile('.github/workflows/ci.yml'));
    codeql = workflowJob(workflow, 'codeql');
    const initStep = stepNamed(codeql, 'Initialize CodeQL');
    configFileInput = asString(stepWith(initStep)['config-file']);
    routing = extractRouting(configFileInput);
  });

  describe('full config (non-PR events)', () => {
    it('selects exactly the security-and-quality suite and the local pack', () => {
      const config = parseYamlRecord(
        readRootFile(FULL_CONFIG_PATH),
        FULL_CONFIG_PATH,
      );
      expect(config).toEqual({
        name: 'LLxprt CodeQL config',
        queries: [
          { uses: 'security-and-quality' },
          { uses: './.github/codeql/queries' },
        ],
      });
    });
  });

  describe('PR config (pull_request, merge_group)', () => {
    it('declares neither queries nor packs and keeps a name', () => {
      const config = parseYamlRecord(
        readRootFile(PR_CONFIG_PATH),
        PR_CONFIG_PATH,
      );
      expect(config).toEqual({
        name: 'LLxprt CodeQL config (PR path)',
      });
    });
  });

  describe('init step config-file routing', () => {
    it('uses the exact event-routing expression', () => {
      expect(configFileInput).toBe(CONFIG_FILE_EXPRESSION);
    });

    it('routes push and workflow_dispatch to the full config and PR events to the PR config', () => {
      const cases: Array<[string, string]> = [
        ['push', './.github/codeql/codeql-config.yml'],
        ['workflow_dispatch', './.github/codeql/codeql-config.yml'],
        ['pull_request', './.github/codeql/codeql-config-pr.yml'],
        ['merge_group', './.github/codeql/codeql-config-pr.yml'],
      ];
      for (const [event, expectedPath] of cases) {
        expect(evaluateRouting(routing, event)).toBe(expectedPath);
      }
    });

    it('references exactly the two config files that exist', () => {
      expect(routing.fullConfigPath).toBe(`./${FULL_CONFIG_PATH}`);
      expect(routing.prConfigPath).toBe(`./${PR_CONFIG_PATH}`);
      expect(existsSync(join(ROOT, FULL_CONFIG_PATH))).toBe(true);
      expect(existsSync(join(ROOT, PR_CONFIG_PATH))).toBe(true);
    });
  });

  describe('mechanism query pack layout', () => {
    it('qlpack declares a vybestack pack name', () => {
      const qlpack = parseYamlRecord(
        readRootFile(`${QUERIES_DIR}/qlpack.yml`),
        'qlpack.yml',
      );
      expect(asString(qlpack['name']).startsWith('vybestack/')).toBe(true);
    });

    it('the pack directory contains exactly qlpack.yml, its lockfile, and the three queries', () => {
      const entries = readdirSync(join(ROOT, QUERIES_DIR)).sort();
      expect(entries).toEqual([
        'cancellation-propagation.ql',
        'cleanup-symmetry-on-error-paths.ql',
        'codeql-pack.lock.yml',
        'qlpack.yml',
        'unbounded-accumulation.ql',
      ]);
    });
  });

  describe('query metadata', () => {
    it('each query has its expected id, kind problem, a severity, and imports javascript', () => {
      for (const [fileName, expectedId] of Object.entries(EXPECTED_QUERY_IDS)) {
        const content = readRootFile(`${QUERIES_DIR}/${fileName}`);
        const idCount = (content.match(/@id\b/g) ?? []).length;
        expect(idCount).toBe(1);
        expect(content.includes(`@id ${expectedId}`)).toBe(true);
        expect(content.includes('@kind problem')).toBe(true);
        expect(/@problem\.severity\s+\S+/.test(content)).toBe(true);
        expect(content.includes('import javascript')).toBe(true);
      }
    });

    it('query ids are unique across files', () => {
      const ids = readdirSync(join(ROOT, QUERIES_DIR))
        .filter((entry) => entry.endsWith('.ql'))
        .map((fileName) => {
          const content = readRootFile(`${QUERIES_DIR}/${fileName}`);
          const match = /@id\s+(\S+)/.exec(content);
          if (match === null) {
            throw new Error(`${fileName} should declare an @id`);
          }
          return match[1] ?? '';
        });
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set(Object.values(EXPECTED_QUERY_IDS)));
    });
  });

  describe('overfit gate (no repo-internal references)', () => {
    it('no query text contains repo paths or project identifiers', () => {
      const queryFiles = readdirSync(join(ROOT, QUERIES_DIR)).filter((entry) =>
        entry.endsWith('.ql'),
      );
      expect(queryFiles.length).toBe(3);
      for (const fileName of queryFiles) {
        const content = readRootFile(`${QUERIES_DIR}/${fileName}`);
        for (const forbidden of FORBIDDEN_QUERY_SUBSTRINGS) {
          expect(content.includes(forbidden)).toBe(false);
        }
        expect(content).not.toMatch(FORBIDDEN_QUERY_EXTENSION_PATTERN);
      }
    });
  });

  describe('codeql job boundaries', () => {
    it('languages remain exactly javascript', () => {
      const initStep = stepNamed(codeql, 'Initialize CodeQL');
      expect(asString(stepWith(initStep)['languages'])).toBe('javascript');
    });
  });
});
