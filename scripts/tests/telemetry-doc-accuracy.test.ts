/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards docs/telemetry.md against the verified source behavior in
 * packages/telemetry/src/telemetry/sdk.ts and
 * packages/core/src/config/configConstructor.ts, so the two cannot silently
 * diverge again.
 *
 * These tests read the REAL source and doc files and assert doc-vs-source
 * agreement. They do NOT mock.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './doc-guard-helpers.ts';

function readSrc(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

/**
 * Extract exported constant string values from a TypeScript source file.
 * Parses the entire source (not line-by-line) so multi-line declarations
 * where the value is on the next line are handled correctly.
 */
/**
 * Collect the string values of `export const <PREFIX>...` declarations.
 *
 * Only single-quoted literals are matched, which is what the Prettier config
 * enforces for this repository. Callers assert the result is non-empty so a
 * wholesale style change surfaces as a failure rather than silent under-
 * extraction.
 */
function extractConstantValues(source: string, prefix: string): string[] {
  const values: string[] = [];
  // Match: export const <NAME with prefix> = 'value';
  // The = and value may be on different lines.
  const regex = new RegExp(
    `export\\s+const\\s+(${prefix}\\w*)\\s*=\\s*'([^']*)'`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    values.push(match[2]);
  }
  return values;
}

/**
 * Extract all `llxprt_code.*` identifiers from text without using
 * a potentially-backtracking regex. Scans character-by-character.
 */
function extractLlxprtCodeNames(text: string): string[] {
  const names: string[] = [];
  const prefix = 'llxprt_code';
  let idx = 0;
  while (true) {
    idx = text.indexOf(prefix, idx);
    if (idx === -1) break;
    let end = idx + prefix.length;
    // Collect trailing .word segments
    while (end < text.length && text[end] === '.') {
      end++;
      const wordStart = end;
      while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) end++;
      if (end === wordStart) break; // dot not followed by word char
    }
    const name = text.substring(idx, end);
    // Skip bare prefix, names ending with dot (e.g. "llxprt_code." from prose),
    // and names with wildcard (e.g. "llxprt_code.*")
    if (name !== prefix && !name.endsWith('.') && !name.includes('*')) {
      names.push(name);
    }
    idx = end;
  }
  return names;
}

describe('telemetry doc accuracy (doc vs source)', () => {
  it('initializeTelemetry is invoked from the config constructor when enabled', () => {
    const configCtor = readSrc('packages/core/src/config/configConstructor.ts');
    expect(configCtor).toContain('initializeTelemetry');
  });

  it('sdk.ts constructs no OTLP exporter (network exporters are disabled)', () => {
    const sdk = readSrc('packages/telemetry/src/telemetry/sdk.ts');
    expect(sdk).not.toMatch(/OTLPExporter/);
    expect(sdk).not.toMatch(/OTLPTraceExporter/);
    expect(sdk).not.toMatch(/OTLPMetricExporter/);
    expect(sdk).not.toMatch(/OTLPLogExporter/);
  });

  it('sdk.ts uses File*Exporter when an outfile is set and Console*Exporter otherwise', () => {
    const sdk = readSrc('packages/telemetry/src/telemetry/sdk.ts');
    expect(sdk).toContain('FileSpanExporter');
    expect(sdk).toContain('FileLogExporter');
    expect(sdk).toContain('FileMetricExporter');
    expect(sdk).toContain('ConsoleSpanExporter');
    expect(sdk).toContain('ConsoleLogRecordExporter');
    expect(sdk).toContain('ConsoleMetricExporter');
  });

  it('sdk.ts registers only HttpInstrumentation (no custom spans)', () => {
    const sdk = readSrc('packages/telemetry/src/telemetry/sdk.ts');
    // The doc claims HTTP is the ONLY instrumentation, so assert the exact
    // contents of the instrumentations array. Merely checking that
    // HttpInstrumentation is present would still pass if another
    // instrumentation were added later, silently invalidating the doc.
    const registered = sdk.match(/instrumentations:\s*\[([^\]]*)\]/);
    expect(registered).not.toBeNull();
    // Split on non-identifier characters instead of a backtracking-prone
    // regex, then keep the Instrumentation class names.
    const names = (registered as RegExpMatchArray)[1]
      .split(/[^A-Za-z0-9_]+/)
      .filter((token) => token.endsWith('Instrumentation'));
    expect(names).toEqual(['HttpInstrumentation']);
    expect(sdk).not.toMatch(/startSpan\s*\(/);
  });

  it('docs/telemetry.md states the telemetry.enabled default is false', () => {
    const doc = readSrc('docs/telemetry.md');
    expect(doc).toMatch(/enabled.*default.*false/i);
  });

  it('docs/telemetry.md documents CLI-over-settings precedence', () => {
    const doc = readSrc('docs/telemetry.md');
    expect(doc).toMatch(/argv.*telemetry|CLI.*preced/i);
  });

  it('every event name in docs/telemetry.md matches a real constant from constants.ts', () => {
    const constantsSource = readSrc(
      'packages/telemetry/src/telemetry/constants.ts',
    );
    const doc = readSrc('docs/telemetry.md');
    // Extract all real event names from constants.ts
    const realEventNames = extractConstantValues(constantsSource, 'EVENT_');
    const realMetricNames = extractConstantValues(constantsSource, 'METRIC_');
    const allRealNames = [...realEventNames, ...realMetricNames];
    // Guard against the extractor silently matching nothing, which would make
    // the per-name loop below vacuous. A bare non-empty check is deliberate:
    // any fixed threshold would break on legitimate constant refactoring.
    expect(realEventNames.length).toBeGreaterThan(0);
    expect(realMetricNames.length).toBeGreaterThan(0);

    // Extract all llxprt_code.* identifiers mentioned in the doc.
    // Use a character-by-character scan to avoid regex backtracking issues.
    const docNames = extractLlxprtCodeNames(doc);
    expect(docNames.length).toBeGreaterThan(0);

    // Every name in the doc must be a real constant
    for (const name of docNames) {
      expect(allRealNames).toContain(name);
    }
  });

  it('docs/telemetry.md does not use llxprt_cli.* names', () => {
    const doc = readSrc('docs/telemetry.md');
    expect(doc).not.toMatch(/llxprt_cli\./);
  });

  it('docs/telemetry.md documents --no-telemetry for session override', () => {
    const doc = readSrc('docs/telemetry.md');
    expect(doc).toMatch(/--no-telemetry/);
  });

  it('docs/telemetry.md accurately states logPrompts does not gate hook I/O', () => {
    const doc = readSrc('docs/telemetry.md');
    expect(doc).toMatch(/hook_input|hook_call/i);
    expect(doc).toMatch(/does.*not.*redact.*hook|not.*gate.*hook/i);
  });

  it('docs/telemetry.md uses the correct settings.telemetry.enabled path everywhere', () => {
    // The config builder resolves `argv.telemetry ?? settings.telemetry?.enabled`.
    // The doc must not reference the wrong `settings.enabled` shorthand.
    const doc = readSrc('docs/telemetry.md');
    expect(doc).not.toMatch(/argv\.telemetry\s*\?\?\s*settings\.enabled/);
    // Every precedence reference must use the full settings.telemetry.enabled path.
    const matches = doc.match(/argv\.telemetry\s*\?\?\s*[^\s,)]+/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
    for (const m of matches!) {
      expect(m).toContain('settings.telemetry.enabled');
    }
  });
});
