/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createLlmPort,
  type LlmRunner,
  buildIsolatedEnvironment,
} from '../../release-notes/llm-port.js';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, relative } from 'node:path';
import { z } from 'zod';

const inlineProfileSchema = z.object({
  modelParams: z.object({ temperature: z.number() }),
  ephemeralSettings: z.object({ 'tools.allowed': z.array(z.string()) }),
});

function parseInlineProfile(args: readonly string[]) {
  const profileIndex = args.indexOf('--profile');
  const profileValue = args.at(profileIndex + 1);
  if (profileIndex < 0 || profileValue === undefined) {
    throw new Error('Expected an inline profile argument');
  }
  return inlineProfileSchema.parse(JSON.parse(profileValue));
}

function successfulRunner(
  inspect: (
    command: string,
    args: readonly string[],
    options: {
      readonly encoding: 'utf8';
      readonly env: NodeJS.ProcessEnv;
      readonly stdio: 'pipe';
      readonly timeout: number;
      readonly cwd: string;
    },
  ) => void,
): LlmRunner {
  return (command, args, options) => {
    inspect(command, args, options);
    return {
      pid: 1,
      output: [
        null,
        '{"session_id":"test","response":"{\\"sourceIds\\":[]}","stats":{}}',
        '',
      ],
      stdout:
        '{"session_id":"test","response":"{\\"sourceIds\\":[]}","stats":{}}',
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    };
  };
}

describe('createLlmPort', () => {
  it('invokes the local built CLI (node <cliBin>), not npx @latest', async () => {
    const port = createLlmPort(
      {
        provider: 'openai',
        model: 'model',
        apiKey: 'secret-key',
        baseUrl: 'https://example.invalid',
      },
      successfulRunner((command, args) => {
        expect(command).toBe('node');
        // First arg must be an absolute path to the local CLI bin, not
        // "@vybestack/llxprt-code@latest" or an npx-style package reference.
        const cliBin = args[0]!;
        expect(cliBin).not.toContain('@latest');
        expect(cliBin).not.toContain('npx');
        expect(cliBin.endsWith('llxprt.cjs')).toBe(true);
      }),
    );

    await expect(port.generateHighlights('{"changes":[]}')).resolves.toBe(
      '{"sourceIds":[]}',
    );
  });

  it('passes the API key via --keyfile (temp file), never in argv', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'super-secret-key' },
      successfulRunner((_command, args) => {
        const join = args.join('\n');
        expect(join).not.toContain('super-secret-key');
        expect(join).not.toContain('--key\n');
        // --keyfile must be present with a temp path value.
        const keyfileIndex = args.indexOf('--keyfile');
        expect(keyfileIndex).toBeGreaterThan(-1);
        const keyfilePath = args[keyfileIndex + 1]!;
        expect(keyfilePath).toContain('llxprt-llm-');
      }),
    );
    await port.generateHighlights('{}');
  });

  it('does not pass --yolo, --key (inline), or any tool-permission-bypassing flag', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, args) => {
        const join = args.join(' ');
        expect(join).not.toContain('--yolo');
        expect(join).not.toContain('--key ');
      }),
    );
    await port.generateHighlights('{}');
  });

  it('prompt instructs the model to return sourceIds (not free-form highlights)', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, args) => {
        const promptIndex = args.indexOf('--prompt');
        const prompt = args[promptIndex + 1]!;
        expect(prompt).toContain('sourceIds');
        expect(prompt).not.toContain('highlights');
      }),
    );
    await port.generateHighlights('{}');
  });

  it('exposes an isolated minimal environment without real HOME/npm/GitHub/Docker secrets', async () => {
    process.env.UNRELATED_WORKFLOW_SECRET = 'must-not-leak';
    process.env.GITHUB_TOKEN = 'ghp-must-not-leak';
    process.env.NPM_TOKEN = 'npm-must-not-leak';
    process.env.DOCKER_PASSWORD = 'docker-must-not-leak';
    process.env.NPM_CONFIG_USERCONFIG = '/must-not-leak';
    process.env.OPENAI_API_KEY = 'sk-must-not-leak';
    const realHome = process.env.HOME;
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, _args, options) => {
        expect(options.env.UNRELATED_WORKFLOW_SECRET).toBeUndefined();
        expect(options.env.GITHUB_TOKEN).toBeUndefined();
        expect(options.env.NPM_TOKEN).toBeUndefined();
        expect(options.env.DOCKER_PASSWORD).toBeUndefined();
        expect(options.env.NPM_CONFIG_USERCONFIG).toBeUndefined();
        expect(options.env.OPENAI_API_KEY).toBeUndefined();
        expect(options.env.PATH).toBeDefined();
        // HOME must be an isolated temp dir, NOT the real HOME.
        expect(options.env.HOME).toBeDefined();
        expect(options.env.HOME).not.toBe(realHome);
        expect(options.env.HOME).toContain('llxprt-llm-');
        // cwd must be the isolated temp dir too.
        expect(options.cwd).toContain('llxprt-llm-');
        expect(options.cwd).not.toBe(process.cwd());
      }),
    );
    await port.generateHighlights('{}');
    delete process.env.UNRELATED_WORKFLOW_SECRET;
    delete process.env.GITHUB_TOKEN;
    delete process.env.NPM_TOKEN;
    delete process.env.DOCKER_PASSWORD;
    delete process.env.NPM_CONFIG_USERCONFIG;
    delete process.env.OPENAI_API_KEY;
  });

  it('does not inherit real HOME — HOME is isolated temp dir', async () => {
    const realHome = process.env.HOME;
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, _args, options) => {
        expect(options.env.HOME).not.toBe(realHome);
        expect(options.env.HOME).toContain('llxprt-llm-');
      }),
    );
    await port.generateHighlights('{}');
  });

  it('forwards only baseUrl env var, no other provider config env', async () => {
    const port = createLlmPort(
      {
        provider: 'openai',
        model: 'model',
        apiKey: 'key',
        baseUrl: 'https://custom.example',
      },
      successfulRunner((_command, _args, options) => {
        expect(options.env.OPENAI_BASE_URL).toBe('https://custom.example');
        // Only PATH, TMPDIR, HOME, USERPROFILE, OPENAI_BASE_URL should be present.
        const keys = Object.keys(options.env).sort();
        expect(keys).toEqual(
          ['HOME', 'OPENAI_BASE_URL', 'PATH', 'TMPDIR', 'USERPROFILE'].sort(),
        );
      }),
    );
    await port.generateHighlights('{}');
  });

  it('uses the supplied existing keyfile when configured', async () => {
    const port = createLlmPort(
      {
        provider: 'openai',
        model: 'model',
        apiKey: 'supplied-key',
        keyfilePath: '/configured/keyfile',
      },
      successfulRunner((_command, args) => {
        const keyfileIndex = args.indexOf('--keyfile');
        expect(args[keyfileIndex + 1]).toBe('/configured/keyfile');
      }),
    );
    await port.generateHighlights('{}');
  });

  it('resolves a relative supplied keyfile to absolute before the child changes cwd', async () => {
    // Create a real keyfile in a temp directory, then reference it via a
    // relative path. The child process runs with cwd=tempDir, so a relative
    // path must be resolved to absolute in the parent process before spawn.
    const keyDir = mkdtempSync(join(tmpdir(), 'llxprt-relkey-'));
    const keyfileName = 'relative-key.txt';
    const fullPath = join(keyDir, keyfileName);
    writeFileSync(fullPath, 'relative-keyfile-content');
    const relativePath = relative(process.cwd(), fullPath);

    try {
      const port = createLlmPort(
        {
          provider: 'openai',
          model: 'model',
          apiKey: '',
          keyfilePath: relativePath,
        },
        successfulRunner((_command, args) => {
          const keyfileIndex = args.indexOf('--keyfile');
          const resolved = args[keyfileIndex + 1]!;
          // The path must be absolute (resolved before cwd change).
          expect(isAbsolute(resolved)).toBe(true);
          // It must point to the original file, not a temp-dir-relative path.
          expect(existsSync(resolved)).toBe(true);
          // The resolved absolute path must normalize to the real file.
          expect(resolved.endsWith(keyfileName)).toBe(true);
        }),
      );
      await port.generateHighlights('{}');
    } finally {
      rmSync(keyDir, { recursive: true, force: true });
    }
  });

  it('writes a mode-0600 temp keyfile when no keyfile configured', async () => {
    let keyfileOk = false;
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'temp-key' },
      successfulRunner((_command, args) => {
        const keyfileIndex = args.indexOf('--keyfile');
        const keyfilePath = args[keyfileIndex + 1]!;
        // Check permissions DURING invocation (temp dir still exists).
        expect(existsSync(keyfilePath)).toBe(true);
        const stat = statSync(keyfilePath);
        expect(stat.mode & 0o777).toBe(0o600);
        keyfileOk = true;
      }),
    );
    await port.generateHighlights('{}');
    expect(keyfileOk).toBe(true);
  });

  it('cleans up the temp directory after successful invocation', async () => {
    let capturedCwd = '';
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, _args, options) => {
        capturedCwd = options.cwd;
      }),
    );
    await port.generateHighlights('{}');
    // The temp HOME/cwd should be removed after invocation.
    expect(existsSync(capturedCwd)).toBe(false);
  });

  it('cleans up the temp directory even on runner failure', async () => {
    const failingRunner: LlmRunner = () => ({
      pid: 1,
      output: [null, '', 'fail'],
      stdout: '',
      stderr: 'fail',
      status: 1,
      signal: null,
      error: undefined,
    });
    let capturedCwd = '';
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      (command, args, options) => {
        capturedCwd = options.cwd;
        return failingRunner(command, args, options);
      },
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow();
    expect(existsSync(capturedCwd)).toBe(false);
  });

  it('buildIsolatedEnvironment produces minimal env without real HOME', () => {
    const env = buildIsolatedEnvironment(
      {
        provider: 'openai',
        model: 'model',
        apiKey: 'key',
        baseUrl: 'https://example',
      },
      '/isolated/home',
    );
    expect(env.HOME).toBe('/isolated/home');
    expect(env.PATH).toBeDefined();
    expect(env.TMPDIR).toBeDefined();
    expect(env.OPENAI_BASE_URL).toBe('https://example');
    expect(env.NPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('buildIsolatedEnvironment sets USERPROFILE to the isolated home for Windows home resolution', () => {
    // On Windows, Node and many CLIs resolve the home directory via
    // USERPROFILE (not HOME). Omitting it means the spawned process either
    // cannot find its home (broken functionality) or falls back to the real
    // user profile (isolation gap). USERPROFILE must point at the isolated
    // home, never the real one.
    const env = buildIsolatedEnvironment(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      '/isolated/home',
    );
    expect(env.USERPROFILE).toBe('/isolated/home');
    expect(env.USERPROFILE).toBe(env.HOME);
  });

  it('buildIsolatedEnvironment omits baseUrl when not configured', () => {
    const env = buildIsolatedEnvironment(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      join(tmpdir(), 'isolated'),
    );
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });

  it('sets a low temperature in the inline profile', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, args) => {
        const profile = parseInlineProfile(args);
        expect(profile.modelParams.temperature).toBe(0.1);
      }),
    );
    await port.generateHighlights('{}');
  });

  it('configures an explicit empty tool allowlist', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      successfulRunner((_command, args) => {
        const profile = parseInlineProfile(args);
        expect(profile.ephemeralSettings['tools.allowed']).toEqual([]);
      }),
    );

    await port.generateHighlights('{}');
  });

  it('redacts supplied keyfile secrets and paths from failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llm-keyfile-test-'));
    const keyfilePath = join(directory, 'secret-keyfile');
    writeFileSync(keyfilePath, 'supplied-secret');
    const runner: LlmRunner = () => ({
      pid: 1,
      output: [null, '', `failed with supplied-secret from ${keyfilePath}`],
      stdout: '',
      stderr: `failed with supplied-secret from ${keyfilePath}`,
      status: 1,
      signal: null,
      error: undefined,
    });
    try {
      const port = createLlmPort(
        {
          provider: 'openai',
          model: 'model',
          apiKey: '',
          keyfilePath,
        },
        runner,
      );

      await expect(port.generateHighlights('{}')).rejects.toThrow(
        'failed with [redacted] from [redacted]',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves invocation failures when a supplied keyfile disappears', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llm-keyfile-missing-'));
    const keyfilePath = join(directory, 'secret-keyfile');
    writeFileSync(keyfilePath, 'supplied-secret');
    const runner: LlmRunner = () => {
      rmSync(keyfilePath);
      return {
        pid: 1,
        output: [null, '', 'original invocation failure'],
        stdout: '',
        stderr: 'original invocation failure',
        status: 1,
        signal: null,
        error: undefined,
      };
    };
    try {
      const port = createLlmPort(
        { provider: 'openai', model: 'model', apiKey: '', keyfilePath },
        runner,
      );

      await expect(port.generateHighlights('{}')).rejects.toThrow(
        'original invocation failure',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('throws on child-process failure', async () => {
    const runner: LlmRunner = () => ({
      pid: 1,
      output: [null, '', 'failure'],
      stdout: '',
      stderr: 'failure',
      status: 1,
      signal: null,
      error: undefined,
    });
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key' },
      runner,
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow(
      'LLxprt Code LLM invocation failed',
    );
  });

  it('rejects API keys containing CR/LF before writing to keyfile', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key\rwith\ncr' },
      successfulRunner(() => {}),
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow(
      'API key contains CR/LF characters',
    );
  });

  it('rejects API keys containing only LF before writing to keyfile', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key\nwith-lf' },
      successfulRunner(() => {}),
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow(
      'API key contains CR/LF characters',
    );
  });

  it('rejects API keys containing only CR before writing to keyfile', async () => {
    const port = createLlmPort(
      { provider: 'openai', model: 'model', apiKey: 'key\rwith-cr' },
      successfulRunner(() => {}),
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow(
      'API key contains CR/LF characters',
    );
  });

  it('rejects API keys with embedded newlines even when a custom keyfilePath is configured', async () => {
    const port = createLlmPort(
      {
        provider: 'openai',
        model: 'model',
        apiKey: 'injected\r\nevil-key',
        keyfilePath: '/tmp/preexisting-keyfile',
      },
      successfulRunner(() => {}),
    );
    await expect(port.generateHighlights('{}')).rejects.toThrow(
      'API key contains CR/LF characters',
    );
  });
});
