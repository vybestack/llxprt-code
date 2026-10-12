/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from './config.js';

function declaration(
  initialSettings: Readonly<Record<string, unknown>>,
): Config {
  return new Config({
    sessionId: 'initial-settings-declaration',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'declared-model',
    provider: 'openai',
    debugMode: false,
    initialSettings,
  });
}

describe('Config initial settings declaration', () => {
  it('retains initial data independently of subsequent changes to the caller data', () => {
    const input = { 'tools.allowed': ['read_file'], 'context-limit': 8192 };
    const config = declaration(input);
    input['tools.allowed'].push('write_file');
    input['context-limit'] = 16384;
    expect(config.getInitialSettings()).toStrictEqual({
      'tools.allowed': ['read_file'],
      'context-limit': 8192,
    });
  });

  it('keeps provider and model declarations separate from runtime store selection', () => {
    const config = declaration({
      activeProvider: 'anthropic',
      model: 'external-model',
    });
    expect([config.getProvider(), config.getModel()]).toStrictEqual([
      'openai',
      'declared-model',
    ]);
  });
});
