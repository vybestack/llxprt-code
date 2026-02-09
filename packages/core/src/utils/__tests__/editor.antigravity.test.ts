/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
    }),
  })),
}));

import { getDiffCommand, allowEditorTypeInSandbox } from '../editor.js';
import type { EditorType } from '../editor.js';

describe('editor.ts antigravity support', () => {
  afterEach(() => {
    delete process.env.SANDBOX;
  });

  it('antigravity is a valid EditorType', () => {
    const editor: EditorType = 'antigravity';
    expect(editor).toBe('antigravity');
  });

  it('getDiffCommand returns --wait --diff for antigravity', () => {
    const cmd = getDiffCommand('/old', '/new', 'antigravity' as EditorType);
    expect(cmd).toEqual({
      command: expect.any(String),
      args: ['--wait', '--diff', '/old', '/new'],
    });
  });

  it('allowEditorTypeInSandbox returns false for antigravity when SANDBOX is set', () => {
    process.env.SANDBOX = 'true';
    expect(allowEditorTypeInSandbox('antigravity' as EditorType)).toBe(false);
  });

  it('allowEditorTypeInSandbox returns true for antigravity when SANDBOX is not set', () => {
    delete process.env.SANDBOX;
    expect(allowEditorTypeInSandbox('antigravity' as EditorType)).toBe(true);
  });
});
