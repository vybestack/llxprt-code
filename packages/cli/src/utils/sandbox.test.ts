/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  buildSandboxEnvArgs,
  getPassthroughEnvVars,
  mountGitConfigFiles,
  setupSshAgentLinux,
} from './sandbox.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// --- Fix 1+2: Error message branding and GIT_DISCOVERY (R1, R2) ---

describe('sandbox error message branding', () => {
  it('image-pull failure message contains discussions URL', async () => {
    const sandboxSource = fs.readFileSync(
      path.join(__dirname, 'sandbox.ts'),
      'utf-8',
    );
    expect(sandboxSource).toContain(
      'https://github.com/vybestack/llxprt-code/discussions',
    );
  });

  it('image-pull failure message does not contain gemini-cli-dev@google.com', () => {
    const sandboxSource = fs.readFileSync(
      path.join(__dirname, 'sandbox.ts'),
      'utf-8',
    );
    expect(sandboxSource).not.toContain('gemini-cli-dev@google.com');
  });
});

describe('container environment variables - GIT_DISCOVERY', () => {
  it('GIT_DISCOVERY_ACROSS_FILESYSTEM=1 is set in container args', () => {
    const sandboxSource = fs.readFileSync(
      path.join(__dirname, 'sandbox.ts'),
      'utf-8',
    );
    expect(sandboxSource).toContain('GIT_DISCOVERY_ACROSS_FILESYSTEM=1');
  });
});

// --- Fix 3: Git config mounts (R3.1-R3.7) ---

describe('mountGitConfigFiles', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existsSyncSpy: any;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds --volume for ~/.gitconfig when file exists (R3.1)', () => {
    existsSyncSpy.mockImplementation(
      (p: fs.PathLike) => String(p) === '/Users/alice/.gitconfig',
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    expect(args).toContain('--volume');
    const volumeArg = args.find(
      (a) => a.includes('.gitconfig') && a.includes(':ro'),
    );
    expect(volumeArg).toBeDefined();
    expect(volumeArg).toContain('/Users/alice/.gitconfig');
  });

  it('adds --volume for ~/.config/git/config when file exists (R3.2)', () => {
    existsSyncSpy.mockImplementation(
      (p: fs.PathLike) =>
        String(p) === path.join('/Users/alice', '.config', 'git', 'config'),
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const volumeArg = args.find(
      (a) => a.includes('.config/git/config') && a.includes(':ro'),
    );
    expect(volumeArg).toBeDefined();
  });

  it('adds --volume for ~/.gitignore_global when file exists (R3.3)', () => {
    existsSyncSpy.mockImplementation(
      (p: fs.PathLike) => String(p) === '/Users/alice/.gitignore_global',
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const volumeArg = args.find(
      (a) => a.includes('.gitignore_global') && a.includes(':ro'),
    );
    expect(volumeArg).toBeDefined();
  });

  it('mounts at both host and container home paths when they differ (R3.4)', () => {
    existsSyncSpy.mockImplementation(
      (p: fs.PathLike) => String(p) === '/Users/alice/.gitconfig',
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const hostMount = args.find((a) =>
      a.startsWith('/Users/alice/.gitconfig:'),
    );
    const containerMount = args.find((a) =>
      a.includes('/home/node/.gitconfig'),
    );
    expect(hostMount).toBeDefined();
    expect(containerMount).toBeDefined();
  });

  it('does not duplicate mount when host and container home are identical (R3.4)', () => {
    existsSyncSpy.mockImplementation(
      (p: fs.PathLike) => String(p) === '/home/node/.gitconfig',
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/home/node', '/home/node');
    const volumeArgs = args.filter(
      (a) => a.includes('.gitconfig') && a.includes(':ro'),
    );
    expect(volumeArgs).toHaveLength(1);
  });

  it('all mounts use :ro mode (R3.5)', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return (
        s === '/Users/alice/.gitconfig' ||
        s === path.join('/Users/alice', '.config', 'git', 'config') ||
        s === '/Users/alice/.gitignore_global' ||
        s === path.join('/Users/alice', '.ssh', 'known_hosts')
      );
    });
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const volumeArgs = args.filter(
      (_, i) => i > 0 && args[i - 1] === '--volume',
    );
    for (const v of volumeArgs) {
      expect(v).toMatch(/:ro$/);
    }
  });

  it('skips mount for files that do not exist (R3.6)', () => {
    existsSyncSpy.mockReturnValue(false);
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    expect(args).toHaveLength(0);
  });

  it('mounts only files that exist, skips missing ones (R3.6)', () => {
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return (
        s === '/Users/alice/.gitconfig' ||
        s === '/Users/alice/.gitignore_global'
      );
    });
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    // Two files exist, each gets host + container path (4 mounts)
    const volumeCount = args.filter((a) => a === '--volume').length;
    expect(volumeCount).toBe(4);
  });

  it('does not mount ~/.git-credentials even when it exists (R3.7)', () => {
    existsSyncSpy.mockReturnValue(true);
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const hasCredentials = args.some((a) => a.includes('.git-credentials'));
    expect(hasCredentials).toBe(false);
  });

  it('adds --volume for ~/.ssh/known_hosts when file exists', () => {
    existsSyncSpy.mockImplementation((p: string) =>
      String(p).includes('known_hosts'),
    );
    const args: string[] = [];
    mountGitConfigFiles(args, '/Users/alice', '/home/node');
    const vol = args.find((a) => a.includes('.ssh/known_hosts'));
    expect(vol).toBeDefined();
    expect(vol).toMatch(/:ro$/);
  });
});

// --- Fix 4: SSH Agent Forwarding (R4-R7) ---

describe('setupSshAgentLinux', () => {
  it('mounts host socket for docker (R5.1)', () => {
    const args: string[] = [];
    setupSshAgentLinux({ command: 'docker' }, args, '/tmp/ssh-agent.sock');
    expect(args).toContain('--volume');
    const vol = args.find((a) => a.includes('/tmp/ssh-agent.sock:/ssh-agent'));
    expect(vol).toBeDefined();
    expect(vol).not.toContain(':z');
    expect(args).toContain('--env');
    expect(args).toContain('SSH_AUTH_SOCK=/ssh-agent');
  });

  it('adds :z SELinux flag for podman on linux (R5.2)', () => {
    const args: string[] = [];
    setupSshAgentLinux({ command: 'podman' }, args, '/tmp/ssh-agent.sock');
    const vol = args.find((a) => a.includes('/tmp/ssh-agent.sock'));
    expect(vol).toBeDefined();
    expect(vol).toMatch(/:z$/);
  });
});
