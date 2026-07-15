/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expandTilde,
  getNumberSetting,
  getStringSetting,
  getStringArraySetting,
} from './subagentSettingsAccess.js';

describe('subagentSettingsAccess expandTilde', () => {
  it('expands leading tilde followed by a Windows separator', () => {
    expect(expandTilde('~\\key.txt')).toBe(path.join(os.homedir(), 'key.txt'));
  });

  it('expands bare tilde followed by a Windows separator', () => {
    expect(expandTilde('~\\')).toBe(path.join(os.homedir(), ''));
  });

  it('expands a bare tilde to the home directory', () => {
    expect(expandTilde('~')).toBe(os.homedir());
  });

  it('expands leading tilde followed by a Unix separator', () => {
    expect(expandTilde('~/key.txt')).toBe(path.join(os.homedir(), 'key.txt'));
  });

  it('returns paths without a tilde unchanged', () => {
    expect(expandTilde('/absolute/path')).toBe('/absolute/path');
    expect(expandTilde('relative/path')).toBe('relative/path');
  });

  it('does not expand a tilde without a separator', () => {
    expect(expandTilde('~key.txt')).toBe('~key.txt');
  });

  it('does not expand a tilde that is not at the start of the path', () => {
    expect(expandTilde('path/~\\key.txt')).toBe('path/~\\key.txt');
  });

  it('returns an empty string unchanged', () => {
    expect(expandTilde('')).toBe('');
  });
});

describe('getSetting helpers with undefined settings (Issue #2472)', () => {
  it('getNumberSetting returns undefined', () => {
    expect(getNumberSetting(undefined, ['temperature'])).toBeUndefined();
  });

  it('getStringSetting returns undefined', () => {
    expect(getStringSetting(undefined, ['auth-key'])).toBeUndefined();
  });

  it('getStringArraySetting returns undefined', () => {
    expect(getStringArraySetting(undefined, ['tools.allowed'])).toBeUndefined();
  });
});

describe('getSetting helpers with null settings (Issue #2472)', () => {
  it('getNumberSetting returns undefined for null', () => {
    expect(getNumberSetting(null, ['temperature'])).toBeUndefined();
  });

  it('getStringSetting returns undefined for null', () => {
    expect(getStringSetting(null, ['auth-key'])).toBeUndefined();
  });

  it('getStringArraySetting returns undefined for null', () => {
    expect(getStringArraySetting(null, ['tools.allowed'])).toBeUndefined();
  });
});
