/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ASTContextCollector } from '../src/tools/ast-edit/context-collector.js';
import { extractImports } from '../src/tools/ast-edit/language-analysis.js';

describe('language-specific import extraction follow-up', () => {
  it('extracts comma-separated Python imports as separate records', () => {
    expect(
      extractImports('import os, package.module as pm\n', 'python'),
    ).toEqual([
      { module: 'os', items: [], line: 1 },
      { module: 'package.module', items: [], line: 1 },
    ]);
  });

  it('excludes trailing comments from Python import modules and items', () => {
    const code =
      'import os  # platform helpers\nfrom pathlib import Path  # path type\n';

    expect(extractImports(code, 'python')).toEqual([
      { module: 'os', items: [], line: 1 },
      { module: 'pathlib', items: ['Path'], line: 2 },
    ]);
  });

  it('rejects empty Go paths and malformed aliases', () => {
    const code = [
      'import ""',
      'import bad-alias "example.com/pkg"',
      'import (',
      '  two aliases "example.com/other"',
      ')',
    ].join('\n');

    expect(extractImports(code, 'go')).toEqual([]);
  });

  it('rejects dynamic, interpolated, and concatenated Ruby requires', () => {
    const code = [
      'require dependency',
      'require "#{name}"',
      "require_relative base + '/file'",
      "require 'json' + suffix",
    ].join('\n');

    expect(extractImports(code, 'ruby')).toEqual([]);
  });

  it('preserves escaped quotes in static Ruby require paths', () => {
    const code = String.raw`require 'don\'t'`;

    expect(extractImports(code, 'ruby')).toEqual([
      { module: String.raw`don\'t`, items: [], line: 1 },
    ]);
  });

  it('accepts escaped Ruby interpolation as static source text', () => {
    const code = String.raw`require "\#{name}"`;

    expect(extractImports(code, 'ruby')).toEqual([
      { module: String.raw`\#{name}`, items: [], line: 1 },
    ]);
  });
});

describe('ASTContextCollector language-specific import integration', () => {
  it('collects Python imports through the real context path', async () => {
    const context = await new ASTContextCollector().collectContext(
      'example.py',
      'import os, package.module as pm\n',
    );

    expect(context.imports).toEqual([
      { module: 'os', items: [], line: 1 },
      { module: 'package.module', items: [], line: 1 },
    ]);
  });

  it('collects Go imports through the real context path', async () => {
    const context = await new ASTContextCollector().collectContext(
      'example.go',
      'import (\n  "fmt"\n  alias "example.com/pkg"\n)\n',
    );

    expect(context.imports).toEqual([
      { module: 'fmt', items: [], line: 2 },
      { module: 'example.com/pkg', items: [], line: 3 },
    ]);
  });

  it('collects only static Ruby imports through the real context path', async () => {
    const context = await new ASTContextCollector().collectContext(
      'example.rb',
      'require(\'json\')\nrequire "#{name}"\n',
    );

    expect(context.imports).toEqual([{ module: 'json', items: [], line: 1 }]);
  });
});
