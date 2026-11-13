/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { DefinitionError, normalizePolicyRegex } from '../index.js';
import type { PolicyRegexInput } from '../index.js';
import { buildArgsPatterns, escapeRegex } from '../../policy/src/utils.js';

describe('normalizePolicyRegex', () => {
  it('preserves input evidence and applies directory args expansion', () => {
    const regex = normalizePolicyRegex({
      path: 'directory-argsPattern',
      text: '.*',
    });

    expect(regex.source).toBe('[^"]*');
    expect(regex.input).toStrictEqual({
      path: 'directory-argsPattern',
      text: '.*',
    });
  });

  it('applies the single-file wrapper limit after generating the wrapper', () => {
    expect(() =>
      normalizePolicyRegex({
        path: 'single-file-commandRegex',
        text: 'a'.repeat(1024),
      }),
    ).toThrow(DefinitionError);
  });

  it('reports invalid native patterns with source evidence', () => {
    let caught: unknown;
    try {
      normalizePolicyRegex({ path: 'direct', source: '[', flags: '' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DefinitionError);
    if (!(caught instanceof DefinitionError))
      throw new Error('Expected regex validation failure');
    expect(caught.problems[0]?.path).toStrictEqual(['input', 'source']);
    expect(caught.problems[0]?.message).toContain('direct');
  });

  it('keeps the 1,024-unit threshold path-specific', () => {
    const acceptedDirectory = normalizePolicyRegex({
      path: 'directory-commandRegex',
      text: 'a'.repeat(1024),
    });
    expect(acceptedDirectory.source).toHaveLength(1039);
    expect(
      normalizePolicyRegex({
        path: 'direct',
        source: 'a'.repeat(1024),
        flags: '',
      }).source,
    ).toHaveLength(1024);
    expect(
      normalizePolicyRegex({
        path: 'direct',
        source: 'a'.repeat(1025),
        flags: '',
      }).source,
    ).toHaveLength(1025);
    expect(() =>
      normalizePolicyRegex({
        path: 'single-file-argsPattern',
        text: 'a'.repeat(1025),
      }),
    ).toThrow(DefinitionError);
  });

  it('checks native RegExp source only on the directory args path', () => {
    const slashPattern = '/'.repeat(513);
    expect(
      normalizePolicyRegex({
        path: 'single-file-argsPattern',
        text: slashPattern,
      }).source,
    ).toHaveLength(1026);
    expect(() =>
      normalizePolicyRegex({
        path: 'directory-argsPattern',
        text: slashPattern,
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects duplicate, unsupported and mutually exclusive flags at native construction', () => {
    for (const flags of ['gg', 'a', 'uv']) {
      expect(() =>
        normalizePolicyRegex({ path: 'direct', source: '.', flags }),
      ).toThrow(DefinitionError);
    }
  });

  it('rejects adjacent quantifiers but keeps grouped nested quantifiers eligible', () => {
    expect(() =>
      normalizePolicyRegex({ path: 'direct', source: 'a**', flags: '' }),
    ).toThrow(DefinitionError);
    expect(
      normalizePolicyRegex({ path: 'direct', source: '(a+)+', flags: '' })
        .source,
    ).toBe('(a+)+');
  });

  it('rejects accessor input without invoking the accessor', () => {
    let getterCalls = 0;
    const input: PolicyRegexInput = {
      get path(): 'direct' {
        getterCalls += 1;
        return 'direct';
      },
      source: 'match',
      flags: '',
    };

    expect(() => normalizePolicyRegex(input)).toThrow(DefinitionError);
    expect(getterCalls).toBe(0);
  });

  it('validates generated single-file prefixes but adds no dynamic-prefix cap', () => {
    expect(() =>
      normalizePolicyRegex({
        path: 'single-file-commandPrefix',
        text: 'a'.repeat(1024),
      }),
    ).toThrow(DefinitionError);
    expect(
      normalizePolicyRegex({
        path: 'dynamic-commandPrefix',
        text: 'a'.repeat(2048),
      }).source,
    ).toContain('a'.repeat(2048));
  });

  it('preserves the per-path escaping and native source returned by legacy producers', () => {
    const text = 'echo "x" \\\\ /tmp/a';
    const directory = normalizePolicyRegex({
      path: 'directory-commandPrefix',
      text,
    });
    const singleFile = normalizePolicyRegex({
      path: 'single-file-commandPrefix',
      text,
    });
    const dynamic = normalizePolicyRegex({
      path: 'dynamic-commandPrefix',
      text,
    });
    const directoryExpected = buildArgsPatterns(undefined, text)[0];
    const singleFileExpected = new RegExp(
      `"command":"${escapeRegex(text)}(?:[\\s"]|$)`,
    );
    const dynamicExpected = new RegExp(
      `"command":"${escapeRegex(text)}(?:[\\s"]|$)`,
    );

    expect(directoryExpected).toBeDefined();
    expect(directory.source).toBe(directoryExpected.source);
    expect(singleFile.source).toBe(singleFileExpected.source);
    expect(dynamic.source).toBe(dynamicExpected.source);
    expect(dynamic.source).not.toBe(directory.source);
  });

  it('returns normalized native sources for generated slash patterns', () => {
    for (const input of [
      { path: 'directory-commandRegex', text: '/' },
      { path: 'single-file-commandRegex', text: '/' },
      { path: 'directory-commandPrefix', text: 'cat /tmp/a' },
    ] satisfies readonly PolicyRegexInput[]) {
      const regex = normalizePolicyRegex(input);
      expect(regex.source).toBe(new RegExp(regex.source, regex.flags).source);
    }
  });
});
