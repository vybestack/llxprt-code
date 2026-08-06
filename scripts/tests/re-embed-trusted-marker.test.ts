/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';

/**
 * Typed wrapper around the CommonJS re-embed script. The `.cjs` is loaded
 * via createRequire so the test exercises the real production file. No type
 * assertions — the module surface is validated at the boundary.
 */
interface EmbeddedBlock {
  startLine: number;
  endLine: number;
}

interface ReEmbedModule {
  reEmbed: (moduleContent: string, workflowContent: string) => string;
  findEmbeddedBlocks: (workflow: string) => EmbeddedBlock[];
  BEGIN: string;
  END: string;
  INDENT: string;
  EXPECTED_SITES: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const requireFromModule = createRequire(import.meta.url);
const rawModule = requireFromModule(
  '../../scripts/re-embed-trusted-marker.cjs',
);

function loadModule(): ReEmbedModule {
  if (!isRecord(rawModule)) {
    throw new Error('re-embed-trusted-marker.cjs should export an object');
  }
  const reEmbed = rawModule['reEmbed'];
  const findEmbeddedBlocks = rawModule['findEmbeddedBlocks'];
  if (!isFunction(reEmbed) || !isFunction(findEmbeddedBlocks)) {
    throw new Error(
      're-embed-trusted-marker.cjs should export reEmbed and findEmbeddedBlocks functions',
    );
  }
  const begin = rawModule['BEGIN'];
  const end = rawModule['END'];
  const indent = rawModule['INDENT'];
  const expectedSites = rawModule['EXPECTED_SITES'];
  if (
    typeof begin !== 'string' ||
    typeof end !== 'string' ||
    typeof indent !== 'string' ||
    typeof expectedSites !== 'number'
  ) {
    throw new Error(
      're-embed-trusted-marker.cjs should export BEGIN, END, INDENT (strings) and EXPECTED_SITES (number)',
    );
  }
  return {
    reEmbed: (moduleContent: string, workflowContent: string): string => {
      const result = reEmbed(moduleContent, workflowContent);
      if (typeof result !== 'string') {
        throw new Error('reEmbed should return a string');
      }
      return result;
    },
    findEmbeddedBlocks: (workflow: string): EmbeddedBlock[] => {
      const result = findEmbeddedBlocks(workflow);
      if (!Array.isArray(result)) {
        throw new Error('findEmbeddedBlocks should return an array');
      }
      return result.map((b: unknown) => {
        if (
          !isRecord(b) ||
          typeof b['startLine'] !== 'number' ||
          typeof b['endLine'] !== 'number'
        ) {
          throw new Error('findEmbeddedBlocks should return block objects');
        }
        return { startLine: b['startLine'], endLine: b['endLine'] };
      });
    },
    BEGIN: begin,
    END: end,
    INDENT: indent,
    EXPECTED_SITES: expectedSites,
  };
}

const RE_EMBED = loadModule();

const MODULE_PATH = path.join(
  ROOT,
  '.github',
  'scripts',
  'ocr-trusted-marker.cjs',
);
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'ocr-review.yml');

describe('scripts/re-embed-trusted-marker.cjs', () => {
  it('is idempotent: re-embedding the real workflow twice produces an identical file', () => {
    const moduleContent = readFileSync(MODULE_PATH, 'utf8');
    const workflowContent = readFileSync(WORKFLOW_PATH, 'utf8');
    const once = RE_EMBED.reEmbed(moduleContent, workflowContent);
    const twice = RE_EMBED.reEmbed(moduleContent, once);
    expect(twice).toBe(once);
  });

  it('produces output containing exactly 4 copies of the indented snippet', () => {
    const moduleContent = readFileSync(MODULE_PATH, 'utf8');
    const workflowContent = readFileSync(WORKFLOW_PATH, 'utf8');
    const updated = RE_EMBED.reEmbed(moduleContent, workflowContent);
    const snippet = extractUnindentedSnippet(moduleContent);
    const indented = snippet
      .split('\n')
      .map((line) => (line.length > 0 ? RE_EMBED.INDENT + line : line))
      .join('\n');
    const count = countOccurrences(updated, indented);
    expect(count).toBe(RE_EMBED.EXPECTED_SITES);
  });

  it('findEmbeddedBlocks does NOT terminate early when a body line contains the END sentinel text as a substring inside a string literal', () => {
    // The old lazy regex / {12}BEGIN...[\s\S]*? {12}END.../g would match
    // the END sentinel text even when it appears INSIDE a string literal
    // on a body line. The exact line-walk only stops at a line that is
    // EXACTLY INDENT+END.
    const bodyLineWithSentinel =
      RE_EMBED.INDENT +
      "const example = '" +
      RE_EMBED.END +
      " inside a string';";
    const workflow = [
      'name: CI',
      RE_EMBED.INDENT + RE_EMBED.BEGIN,
      RE_EMBED.INDENT + 'function foo() {',
      bodyLineWithSentinel,
      RE_EMBED.INDENT + '  return 1;',
      RE_EMBED.INDENT + '}',
      RE_EMBED.INDENT + RE_EMBED.END,
    ].join('\n');
    const blocks = RE_EMBED.findEmbeddedBlocks(workflow);
    expect(blocks).toHaveLength(1);
    const lines = workflow.split('\n');
    // The block must span from BEGIN (line 1) to the real END (line 6),
    // NOT the sentinel-text-inside-a-string body line (line 3).
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(6);
    // The body line must still be present between start and end.
    expect(lines[blocks[0].endLine]).toBe(RE_EMBED.INDENT + RE_EMBED.END);
  });

  it('throws when the number of embedded blocks is not 4', () => {
    const moduleContent = readFileSync(MODULE_PATH, 'utf8');
    const snippet = extractUnindentedSnippet(moduleContent);
    const indented = snippet
      .split('\n')
      .map((line) => (line.length > 0 ? RE_EMBED.INDENT + line : line))
      .join('\n');
    const workflow = [
      'name: CI',
      '    steps:',
      '      - run: |',
      indented,
      '        const x = 1;',
    ].join('\n');
    expect(() => RE_EMBED.reEmbed(moduleContent, workflow)).toThrow(
      /Expected 4 embedded snippet sites, found 1/,
    );
  });

  it('throws when a BEGIN sentinel has no matching END sentinel', () => {
    const moduleContent = readFileSync(MODULE_PATH, 'utf8');
    const workflow = [
      'name: CI',
      RE_EMBED.INDENT + RE_EMBED.BEGIN,
      RE_EMBED.INDENT + 'function foo() {}',
    ].join('\n');
    expect(() => RE_EMBED.reEmbed(moduleContent, workflow)).toThrow(
      /Unterminated embedded snippet/,
    );
  });
});

function extractUnindentedSnippet(moduleContent: string): string {
  const beginIdx = moduleContent.indexOf(RE_EMBED.BEGIN);
  const endIdx = moduleContent.indexOf(RE_EMBED.END);
  return moduleContent.slice(beginIdx, endIdx + RE_EMBED.END.length);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}
