/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  restoreEnv,
  setEnv,
} from '../../../test-utils/src/env-test-helpers.js';
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { detectIde, IDE_DEFINITIONS } from './detect-ide.js';

describe('detectIde', () => {
  const ideProcessInfo = { pid: 123, command: 'some/path/to/code' };
  const ideProcessInfoNoCode = { pid: 123, command: 'some/path/to/fork' };

  beforeEach(() => {
    // Ensure these env vars don't leak from the host environment
    setEnv('ANTIGRAVITY_CLI_ALIAS', '');
    setEnv('TERM_PROGRAM', '');
    setEnv('CURSOR_TRACE_ID', '');
    setEnv('CODESPACES', '');
    setEnv('VSCODE_IPC_HOOK_CLI', '');
    setEnv('EDITOR_IN_CLOUD_SHELL', '');
    setEnv('CLOUD_SHELL', '');
    setEnv('TERM_PRODUCT', '');
    setEnv('MONOSPACE_ENV', '');
    setEnv('FIREBASE_DEPLOY_AGENT', '');
    setEnv('REPLIT_USER', '');
    setEnv('__COG_BASHRC_SOURCED', '');
  });

  afterEach(() => {
    restoreEnv();
    // Clear Cursor-specific environment variables that might interfere with tests
    delete process.env['CURSOR_TRACE_ID'];
  });

  it('should return undefined if TERM_PROGRAM is not vscode', () => {
    setEnv('TERM_PROGRAM', '');
    expect(detectIde(ideProcessInfo)).toBeUndefined();
  });

  it('should detect Devin', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('__COG_BASHRC_SOURCED', '1');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.devin);
  });

  it('should detect Replit', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('REPLIT_USER', 'testuser');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.replit);
  });

  it('should detect Cursor', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('CURSOR_TRACE_ID', 'some-id');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.cursor);
  });

  it('should detect Codespaces', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('CODESPACES', 'true');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.codespaces);
  });

  it('should detect Cloud Shell via EDITOR_IN_CLOUD_SHELL', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('EDITOR_IN_CLOUD_SHELL', 'true');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.cloudshell);
  });

  it('should detect Cloud Shell via CLOUD_SHELL', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('CLOUD_SHELL', 'true');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.cloudshell);
  });

  it('should detect Trae', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('TERM_PRODUCT', 'Trae');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.trae);
  });

  it('should detect Firebase Studio via FIREBASE_DEPLOY_AGENT', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('FIREBASE_DEPLOY_AGENT', 'true');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.firebasestudio);
  });

  it('should detect Firebase Studio via MONOSPACE_ENV', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('MONOSPACE_ENV', 'true');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.firebasestudio);
  });

  it('should detect VSCode when no other IDE is detected and command includes "code"', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('MONOSPACE_ENV', '');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.vscode);
  });

  it('should detect VSCodeFork when no other IDE is detected and command does not include "code"', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('MONOSPACE_ENV', '');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfoNoCode)).toBe(IDE_DEFINITIONS.vscodefork);
  });

  it('should prioritize other IDEs over VSCode detection', () => {
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('REPLIT_USER', 'testuser');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.replit);
  });

  it('should detect Sublime Text', () => {
    setEnv('TERM_PROGRAM', 'sublime');
    setEnv('ANTIGRAVITY_CLI_ALIAS', '');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.sublimetext);
  });

  it('should prioritize Antigravity over Sublime Text', () => {
    setEnv('TERM_PROGRAM', 'sublime');
    setEnv('ANTIGRAVITY_CLI_ALIAS', 'agy');
    expect(detectIde(ideProcessInfo)).toBe(IDE_DEFINITIONS.antigravity);
  });
});

describe('detectIde with ideInfoFromFile', () => {
  const ideProcessInfo = { pid: 123, command: 'some/path/to/code' };

  afterEach(() => {
    restoreEnv();
  });

  beforeEach(() => {
    setEnv('ANTIGRAVITY_CLI_ALIAS', '');
    setEnv('TERM_PROGRAM', '');
    setEnv('CURSOR_TRACE_ID', '');
    setEnv('CODESPACES', '');
    setEnv('VSCODE_IPC_HOOK_CLI', '');
    setEnv('EDITOR_IN_CLOUD_SHELL', '');
    setEnv('CLOUD_SHELL', '');
    setEnv('TERM_PRODUCT', '');
    setEnv('MONOSPACE_ENV', '');
    setEnv('REPLIT_USER', '');
    setEnv('__COG_BASHRC_SOURCED', '');
  });

  it('should use the name and displayName from the file', () => {
    const ideInfoFromFile = {
      name: 'custom-ide',
      displayName: 'Custom IDE',
    };
    expect(detectIde(ideProcessInfo, ideInfoFromFile)).toStrictEqual(
      ideInfoFromFile,
    );
  });

  it('should fall back to env detection if name is missing', () => {
    const ideInfoFromFile = { displayName: 'Custom IDE' };
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo, ideInfoFromFile)).toBe(
      IDE_DEFINITIONS.vscode,
    );
  });

  it('should fall back to env detection if displayName is missing', () => {
    const ideInfoFromFile = { name: 'custom-ide' };
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('CURSOR_TRACE_ID', '');
    expect(detectIde(ideProcessInfo, ideInfoFromFile)).toBe(
      IDE_DEFINITIONS.vscode,
    );
  });
});
