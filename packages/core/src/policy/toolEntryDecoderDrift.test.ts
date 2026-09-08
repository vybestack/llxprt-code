/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drift test: policy's zero-dep normalizeToolName duplicate must stay
 * behavior-identical to the shared decoder in tools
 * (canonicalizePolicyToolEntry) — see issue #2533 Phase B2a.
 */

import { describe, it, expect } from 'bun:test';
import { normalizeToolName } from '@vybestack/llxprt-code-policy';
import { canonicalizePolicyToolEntry } from '@vybestack/llxprt-code-tools';

const CORPUS = [
  'ShellTool',
  'ShellTool(npm test)',
  'run_shell_command',
  'run_shell_command(npm test)',
  'ReadFileTool',
  'read_file',
  'user-server__*',
  'mcp__server__tool*',
  'search_file_content',
  '  padded  ',
  'TodoRead',
  '',
] as const;

describe('policy tool-entry decoder drift', () => {
  it('policy normalizeToolName matches tools canonicalizePolicyToolEntry over the corpus', () => {
    for (const entry of CORPUS) {
      expect(normalizeToolName(entry)).toBe(canonicalizePolicyToolEntry(entry));
    }
  });

  it('decodes legacy ShellTool spellings to the canonical registry name', () => {
    expect(canonicalizePolicyToolEntry('ShellTool')).toBe('run_shell_command');
    expect(canonicalizePolicyToolEntry('ShellTool(npm test)')).toBe(
      'run_shell_command',
    );
    expect(canonicalizePolicyToolEntry('ShellTool(wc)')).toBe(
      'run_shell_command',
    );
  });

  it('preserves wildcard policy entries verbatim', () => {
    expect(canonicalizePolicyToolEntry('user-server__*')).toBe(
      'user-server__*',
    );
    expect(normalizeToolName('mcp__server__tool*')).toBe('mcp__server__tool*');
  });
});
