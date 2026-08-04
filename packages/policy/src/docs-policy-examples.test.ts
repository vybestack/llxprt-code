/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards the worked TOML examples published in docs/policy-configuration.md.
 *
 * The page previously shipped rules with decimal priorities, which
 * PolicyRuleSchema rejects outright — a reader who copied an example got a
 * policy file the loader refused to load. These tests load every published
 * example through the real loader so a regression fails here rather than in a
 * user's config directory.
 *
 * Snippets that are deliberately wrong (the troubleshooting section) are
 * fenced as `text`, not `toml`, so they are excluded by construction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-policy';
import {
  loadPoliciesFromToml,
  PolicyEngine,
} from '@vybestack/llxprt-code-policy';

const DOC_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/policy-configuration.md',
);

/** Tier the page tells readers their own files load at. */
const USER_TIER = 2;

/**
 * Lower bound on the number of published rule examples. Guards against a
 * silently-empty extraction making every assertion below vacuous.
 */
const MIN_EXPECTED_EXAMPLES = 10;

/**
 * Matches two consecutive backslashes in a compiled pattern's source, which is
 * what over-escaping in a TOML basic string produces.
 */
const DOUBLED_BACKSLASH = new RegExp(String.raw`\\\\`);

interface TomlExample {
  /** 1-based line number of the opening fence, for failure messages. */
  line: number;
  body: string;
}

/** Extracts every fenced `toml` block, recording where each one starts. */
function extractTomlExamples(markdown: string): TomlExample[] {
  const lines = markdown.split('\n');
  const examples: TomlExample[] = [];
  let openedAt: number | null = null;
  let buffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (openedAt === null) {
      if (line === '```toml') {
        openedAt = i + 1;
        buffer = [];
      }
    } else if (line === '```') {
      examples.push({ line: openedAt, body: buffer.join('\n') });
      openedAt = null;
    } else {
      buffer.push(lines[i]);
    }
  }

  if (openedAt !== null) {
    throw new Error(
      `Unterminated toml fence opened at line ${openedAt} of ${DOC_PATH}`,
    );
  }

  return examples;
}

/** Matches a `priority = <value>` assignment at the start of a line. */
const PRIORITY_ASSIGNMENT = /^[ \t]*priority[ \t]*=[ \t]*([^\s#]+)/gm;

/** Matches an `mcpName = "<value>"` assignment at the start of a line. */
const MCP_NAME_ASSIGNMENT = /^[ \t]*mcpName[ \t]*=[ \t]*"([^"]*)"/gm;

/** Authored priority values written in an example, in source order. */
function authoredPriorities(body: string): number[] {
  return [...body.matchAll(PRIORITY_ASSIGNMENT)].map((match) =>
    Number(match[1]),
  );
}

/** Server names written in an example's `mcpName` fields, in source order. */
function authoredMcpNames(body: string): string[] {
  return [...body.matchAll(MCP_NAME_ASSIGNMENT)].map((match) => match[1]);
}

describe('docs/policy-configuration.md TOML examples', () => {
  let tempDir: string;
  let ruleExamples: TomlExample[];

  /** Loads one published example the way the engine loads a user policy file. */
  async function loadExample(example: TomlExample, label: string) {
    const exampleDir = path.join(tempDir, `${label}-${example.line}`);
    await fs.mkdir(exampleDir, { recursive: true });
    await fs.writeFile(
      path.join(exampleDir, 'example.toml'),
      example.body,
      'utf-8',
    );
    return loadPoliciesFromToml(
      ApprovalMode.DEFAULT,
      [exampleDir],
      () => USER_TIER,
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-docs-'));
    const markdown = await fs.readFile(DOC_PATH, 'utf-8');
    ruleExamples = extractTomlExamples(markdown).filter((example) =>
      example.body.includes('[[rule]]'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('publishes enough rule examples for these guards to be meaningful', () => {
    expect(ruleExamples.length).toBeGreaterThanOrEqual(MIN_EXPECTED_EXAMPLES);
  });

  it('loads every published rule example without a single load error', async () => {
    const failures: string[] = [];

    for (const example of ruleExamples) {
      const { rules, errors } = await loadExample(example, 'load');

      for (const error of errors) {
        failures.push(
          `line ${example.line}: ${error.errorType} — ${error.message}${
            error.details ? `\n${error.details}` : ''
          }`,
        );
      }
      if (rules.length === 0) {
        failures.push(`line ${example.line}: produced no rules`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('writes every priority as an integer inside the authored range', () => {
    const offenders: string[] = [];

    for (const example of ruleExamples) {
      for (const priority of authoredPriorities(example.body)) {
        if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
          offenders.push(`line ${example.line}: priority = ${priority}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('escapes regex backslashes for TOML exactly once', async () => {
    // A TOML basic string consumes one level of escaping, so a doubled
    // backslash in the file reaches the regex engine as a single one. Doubling
    // it again yields a pattern that matches a literal backslash and therefore
    // never fires. No example on the page intends that.
    const overEscaped: string[] = [];

    for (const example of ruleExamples) {
      const { rules } = await loadExample(example, 'escape');

      for (const rule of rules) {
        const source = rule.argsPattern?.source;
        if (source !== undefined && DOUBLED_BACKSLASH.test(source)) {
          overEscaped.push(`line ${example.line}: ${source}`);
        }
      }
    }

    expect(overEscaped).toEqual([]);
  });

  it('names MCP servers the way policy evaluation sees them', async () => {
    // An MCP invocation reaches the engine as `<server>__<tool>` with the
    // server name supplied separately. The longer name the model uses carries
    // an extra prefix, and a rule written against that longer name matches
    // nothing. A server name containing `__` is that mistake.
    const mcpExamples = ruleExamples.filter(
      (example) => authoredMcpNames(example.body).length > 0,
    );
    expect(mcpExamples.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const example of mcpExamples) {
      for (const server of authoredMcpNames(example.body)) {
        if (server.includes('__')) {
          offenders.push(`line ${example.line}: mcpName = "${server}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('governs a real MCP invocation with the documented server rules', async () => {
    // Loading is not matching. Evaluate the published MCP example the way the
    // runtime does, so an example that validates but never fires still fails.
    const example = ruleExamples.find((candidate) =>
      candidate.body.includes('mcpName'),
    );
    if (example === undefined) {
      throw new Error(`No mcpName example found in ${DOC_PATH}`);
    }

    const server = authoredMcpNames(example.body)[0];
    const { rules, errors } = await loadExample(example, 'mcp');
    expect(errors).toEqual([]);

    const engine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.DENY,
    });

    // Some rule from the example must govern a tool on that server, rather
    // than falling through to the default decision.
    expect(engine.evaluate(`${server}__any_tool`, {}, server)).not.toBe(
      PolicyDecision.DENY,
    );
  });

  it('resolves user-directory examples inside the user tier band', async () => {
    const exampleDir = path.join(tempDir, 'all');
    await fs.mkdir(exampleDir, { recursive: true });

    for (const example of ruleExamples) {
      await fs.writeFile(
        path.join(exampleDir, `example-${example.line}.toml`),
        example.body,
        'utf-8',
      );
    }

    const { rules } = await loadPoliciesFromToml(
      ApprovalMode.DEFAULT,
      [exampleDir],
      () => USER_TIER,
    );

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.priority).toBeGreaterThanOrEqual(2);
      expect(rule.priority).toBeLessThanOrEqual(2.999);
    }
  });
});
