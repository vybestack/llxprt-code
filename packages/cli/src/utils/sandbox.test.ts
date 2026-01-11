/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildSandboxEnvArgs, getPassthroughEnvVars } from './sandbox.js';

describe('getPassthroughEnvVars', () => {
  let mockEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    mockEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      LLXPRT_CODE_IDE_SERVER_PORT: '3000',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      LLXPRT_CODE_WELCOME_CONFIG_PATH: '/config.json',
      TERM_PROGRAM: 'VSCode',
      NODE_ENV: 'test',
    };
  });

  it('should return empty object when no passthrough vars are set', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
    };

    const result = getPassthroughEnvVars(env);

    expect(result).toEqual({});
  });

  it('should return LLXPRT_CODE_IDE_SERVER_PORT when set', () => {
    const result = getPassthroughEnvVars(mockEnv);

    expect(result).toHaveProperty('LLXPRT_CODE_IDE_SERVER_PORT', '3000');
  });

  it('should return LLXPRT_CODE_IDE_WORKSPACE_PATH when set', () => {
    const result = getPassthroughEnvVars(mockEnv);

    expect(result).toHaveProperty(
      'LLXPRT_CODE_IDE_WORKSPACE_PATH',
      '/workspace',
    );
  });

  it('should return LLXPRT_CODE_WELCOME_CONFIG_PATH when set', () => {
    const result = getPassthroughEnvVars(mockEnv);

    expect(result).toHaveProperty(
      'LLXPRT_CODE_WELCOME_CONFIG_PATH',
      '/config.json',
    );
  });

  it('should return TERM_PROGRAM when set', () => {
    const result = getPassthroughEnvVars(mockEnv);

    expect(result).toHaveProperty('TERM_PROGRAM', 'VSCode');
  });

  it('should return all passthrough variables when all are set', () => {
    const result = getPassthroughEnvVars(mockEnv);

    expect(result).toEqual({
      LLXPRT_CODE_IDE_SERVER_PORT: '3000',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      LLXPRT_CODE_WELCOME_CONFIG_PATH: '/config.json',
      TERM_PROGRAM: 'VSCode',
    });
  });

  it('should ignore passthrough vars with empty string values', () => {
    const env: NodeJS.ProcessEnv = {
      LLXPRT_CODE_IDE_SERVER_PORT: '',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      TERM_PROGRAM: 'VSCode',
    };

    const result = getPassthroughEnvVars(env);

    expect(result).toEqual({
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      TERM_PROGRAM: 'VSCode',
    });
  });

  it('should ignore passthrough vars with undefined values', () => {
    const env: NodeJS.ProcessEnv = {
      LLXPRT_CODE_IDE_SERVER_PORT: undefined,
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      TERM_PROGRAM: 'VSCode',
    };

    const result = getPassthroughEnvVars(env);

    expect(result).toEqual({
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      TERM_PROGRAM: 'VSCode',
    });
  });

  it('should handle special characters in variable values', () => {
    const env: NodeJS.ProcessEnv = {
      LLXPRT_CODE_IDE_SERVER_PORT: '3000:3001',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/path/to/workspace with spaces',
      TERM_PROGRAM: 'iTerm.app',
    };

    const result = getPassthroughEnvVars(env);

    expect(result).toEqual({
      LLXPRT_CODE_IDE_SERVER_PORT: '3000:3001',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/path/to/workspace with spaces',
      TERM_PROGRAM: 'iTerm.app',
    });
  });

  it('should not mutate the input object', () => {
    const env: NodeJS.ProcessEnv = { ...mockEnv };
    getPassthroughEnvVars(env);

    expect(env).toEqual(mockEnv);
  });

  it('should return a new object', () => {
    const env: NodeJS.ProcessEnv = { ...mockEnv };
    const result = getPassthroughEnvVars(env);

    expect(result).not.toBe(env);
  });
});

describe('buildSandboxEnvArgs', () => {
  let mockEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    mockEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      LLXPRT_CODE_IDE_SERVER_PORT: '3000',
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/workspace',
      LLXPRT_CODE_WELCOME_CONFIG_PATH: '/config.json',
      TERM_PROGRAM: 'VSCode',
      NODE_ENV: 'test',
    };
  });

  it('should return empty array when no passthrough vars are set', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
    };

    const result = buildSandboxEnvArgs(env);

    expect(result).toEqual([]);
  });

  it('should format passthrough vars as CLI args with --env prefix', () => {
    const result = buildSandboxEnvArgs({
      LLXPRT_CODE_IDE_SERVER_PORT: '3000',
      TERM_PROGRAM: 'VSCode',
    });

    expect(result).toEqual([
      '--env',
      'LLXPRT_CODE_IDE_SERVER_PORT=3000',
      '--env',
      'TERM_PROGRAM=VSCode',
    ]);
  });

  it('should include all set passthrough variables', () => {
    const result = buildSandboxEnvArgs(mockEnv);

    expect(result).toEqual([
      '--env',
      'LLXPRT_CODE_IDE_SERVER_PORT=3000',
      '--env',
      'LLXPRT_CODE_IDE_WORKSPACE_PATH=/workspace',
      '--env',
      'LLXPRT_CODE_WELCOME_CONFIG_PATH=/config.json',
      '--env',
      'TERM_PROGRAM=VSCode',
    ]);
  });

  it('should handle values containing equals signs', () => {
    const result = buildSandboxEnvArgs({
      LLXPRT_CODE_IDE_SERVER_PORT: '3000=3001',
    });

    expect(result).toEqual(['--env', 'LLXPRT_CODE_IDE_SERVER_PORT=3000=3001']);
  });

  it('should handle values with spaces', () => {
    const result = buildSandboxEnvArgs({
      LLXPRT_CODE_IDE_WORKSPACE_PATH: '/path/to/workspace with spaces',
    });

    expect(result).toEqual([
      '--env',
      'LLXPRT_CODE_IDE_WORKSPACE_PATH=/path/to/workspace with spaces',
    ]);
  });

  it('should not mutate the input object', () => {
    const env: NodeJS.ProcessEnv = { ...mockEnv };
    const originalEnv = { ...env };
    buildSandboxEnvArgs(env);

    expect(env).toEqual(originalEnv);
  });

  it('should return a new array', () => {
    const env: NodeJS.ProcessEnv = { ...mockEnv };
    const result1 = buildSandboxEnvArgs(env);
    const result2 = buildSandboxEnvArgs(env);

    expect(result2).not.toBe(result1);
  });
});
