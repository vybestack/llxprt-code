/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectIdeFromEnv,
  IDE_DEFINITIONS,
  isCloudShell,
} from '../detect-ide.js';

describe('detect-ide.ts antigravity + isCloudShell', () => {
  const savedEnv: Record<string, string | undefined> = {};

  const envKeys = [
    'ANTIGRAVITY_CLI_ALIAS',
    '__COG_BASHRC_SOURCED',
    'REPLIT_USER',
    'CURSOR_TRACE_ID',
    'CODESPACES',
    'EDITOR_IN_CLOUD_SHELL',
    'CLOUD_SHELL',
    'TERM_PRODUCT',
    'FIREBASE_DEPLOY_AGENT',
    'MONOSPACE_ENV',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('IDE_DEFINITIONS includes antigravity', () => {
    expect(IDE_DEFINITIONS.antigravity).toEqual({
      name: 'antigravity',
      displayName: 'Antigravity',
    });
  });

  it('detectIdeFromEnv returns antigravity when ANTIGRAVITY_CLI_ALIAS is set', () => {
    process.env.ANTIGRAVITY_CLI_ALIAS = '1';
    expect(detectIdeFromEnv()).toEqual(IDE_DEFINITIONS.antigravity);
  });

  it('detectIdeFromEnv returns cloudshell for CLOUD_SHELL env', () => {
    process.env.CLOUD_SHELL = '1';
    expect(detectIdeFromEnv()).toEqual(IDE_DEFINITIONS.cloudshell);
  });

  it('detectIdeFromEnv returns cloudshell for EDITOR_IN_CLOUD_SHELL env', () => {
    process.env.EDITOR_IN_CLOUD_SHELL = '1';
    expect(detectIdeFromEnv()).toEqual(IDE_DEFINITIONS.cloudshell);
  });
});

describe('isCloudShell()', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.CLOUD_SHELL = process.env.CLOUD_SHELL;
    savedEnv.EDITOR_IN_CLOUD_SHELL = process.env.EDITOR_IN_CLOUD_SHELL;
    delete process.env.CLOUD_SHELL;
    delete process.env.EDITOR_IN_CLOUD_SHELL;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns true when CLOUD_SHELL is set', () => {
    process.env.CLOUD_SHELL = 'true';
    expect(isCloudShell()).toBe(true);
  });

  it('returns true when EDITOR_IN_CLOUD_SHELL is set', () => {
    process.env.EDITOR_IN_CLOUD_SHELL = '1';
    expect(isCloudShell()).toBe(true);
  });

  it('returns false when neither cloud shell env is set', () => {
    expect(isCloudShell()).toBe(false);
  });
});
