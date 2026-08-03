/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DebugLogger, FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  buildContainerRunArgs,
  setupContainerNetworking,
  addContainerEnvVars,
  addContainerVolumeMounts,
} from './sandbox-containers.js';

// Explicit factory mock: Bun's automock walks every export of
// node:child_process and hits getters that access private fields
// (this.#stdin), crashing the compat shim. Spread importOriginal so
// everything else in the module graph keeps the real implementations —
// Vitest replaces the entire module namespace with the factory return.
//
// Only execSync and spawn are stubbed: those are the process-launching
// calls these tests must not actually perform. `exec` is deliberately left
// real, because sandbox-containers.ts evaluates promisify(exec) at module
// scope; a stub there would produce an execAsync that never settles and
// would hang the first test to reach that path.
vi.mock('node:child_process', async (importOriginal) => {
  const actual: typeof import('node:child_process') = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const NETWORK_ENV_KEYS = [
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_PROXY_COMMAND',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SANDBOX_FLAGS',
  'SANDBOX_ENV',
  'VIRTUAL_ENV',
  'NODE_OPTIONS',
  'DEBUG',
] as const;
const PROXIED_NETWORK_ERROR =
  'Sandbox network mode "proxied" requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.';
const CONFIG = { command: 'docker', image: 'test' } as const;

function setNetworkEnvironment(
  primary: string | undefined,
  legacy: string | undefined,
  proxyCommand: string | undefined,
): void {
  const values = {
    LLXPRT_SANDBOX_NETWORK: primary,
    SANDBOX_NETWORK: legacy,
    LLXPRT_SANDBOX_PROXY_COMMAND: proxyCommand,
  };
  for (const key of NETWORK_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function buildArgs(fixturePath: string): string[] {
  return buildContainerRunArgs(
    CONFIG,
    'test-image',
    fixturePath,
    '/workspace',
    fixturePath,
  );
}

function buildThenSetup(fixturePath: string): {
  readonly args: string[];
  readonly proxyCommand: string | undefined;
} {
  const args = buildArgs(fixturePath);
  return {
    args,
    proxyCommand: setupContainerNetworking(args, CONFIG, false),
  };
}

describe.sequential('#1456 container network policy', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-1456-'));
    vi.resetAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'rejects proxied mode with %s command before build-to-setup effects',
    (_label, command) => {
      setNetworkEnvironment('proxied', undefined, command);

      const orchestrate = () => buildThenSetup(fixturePath);
      expect(orchestrate).toThrowError(FatalSandboxError);
      expect(orchestrate).toThrowError(PROXIED_NETWORK_ERROR);
      expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
    },
  );

  it('rejects legacy-only proxied mode without a command', () => {
    setNetworkEnvironment(undefined, 'proxied', undefined);

    expect(() => buildThenSetup(fixturePath)).toThrowError(
      PROXIED_NETWORK_ERROR,
    );
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps a defined-empty primary authoritative over legacy proxied', () => {
    setNetworkEnvironment('', 'proxied', undefined);

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBeUndefined();
    expect(args).not.toContain('--network');
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps primary "on" authoritative over legacy proxied', () => {
    setNetworkEnvironment('on', 'proxied', undefined);

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBeUndefined();
    expect(args).not.toContain('--network');
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps primary proxied authoritative over legacy off', () => {
    setNetworkEnvironment('proxied', 'off', undefined);

    expect(() => buildThenSetup(fixturePath)).toThrowError(
      PROXIED_NETWORK_ERROR,
    );
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('retains the exact network-off argument pair', () => {
    setNetworkEnvironment('off', undefined, undefined);

    const args = buildArgs(fixturePath);
    const networkIndex = args.indexOf('--network');
    expect(args.slice(networkIndex, networkIndex + 2)).toStrictEqual([
      '--network',
      'none',
    ]);
  });

  it.each(['on', undefined])(
    'retains network %s without a policy flag',
    (mode) => {
      setNetworkEnvironment(mode, undefined, undefined);

      expect(buildArgs(fixturePath)).not.toContain('--network');
    },
  );

  it('runs real build-to-setup orchestration through existing isolated networks', () => {
    const configuredCommand = '  mitmproxy --mode regular  ';
    setNetworkEnvironment('proxied', undefined, configuredCommand);
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBe(configuredCommand);
    expect(args).toContain(
      'HTTPS_PROXY=http://llxprt-code-sandbox-proxy:8877/',
    );
    expect(args).toContain('HTTP_PROXY=http://llxprt-code-sandbox-proxy:8877/');
    const networkIndex = args.indexOf('--network');
    expect(args.filter((argument) => argument === '--network')).toHaveLength(1);
    expect(args.slice(networkIndex, networkIndex + 2)).toStrictEqual([
      '--network',
      'llxprt-code-sandbox',
    ]);
    expect(vi.mocked(childProcess.execSync)).toHaveBeenCalledWith(
      'docker network inspect llxprt-code-sandbox || docker network create --internal llxprt-code-sandbox',
    );
    expect(vi.mocked(childProcess.execSync)).toHaveBeenCalledWith(
      'docker network inspect llxprt-code-sandbox-proxy || docker network create llxprt-code-sandbox-proxy',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

const CONTAINER_ENV_VARS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_GCA',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GEMINI_MODEL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'TERM',
  'COLORTERM',
  'SANDBOX_ENV',
  'VIRTUAL_ENV',
  'NODE_OPTIONS',
  'LLXPRT_SANDBOX_MOUNTS',
  'SANDBOX_MOUNTS',
] as const;

const ENV_CONFIG = { command: 'docker', image: 'test' } as const;

describe.sequential('#2946 container credential isolation', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let tempDirs: string[] = [];

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tempDirs = [];
    for (const key of CONTAINER_ENV_VARS) delete process.env[key];
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not forward GEMINI_API_KEY or GOOGLE_API_KEY into the container env', () => {
    process.env.GEMINI_API_KEY = 'sentinel-gemini-key-2946';
    process.env.GOOGLE_API_KEY = 'sentinel-google-key-2946';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    expect(args.some((arg) => arg.startsWith('GEMINI_API_KEY='))).toBe(false);
    expect(args.some((arg) => arg.startsWith('GOOGLE_API_KEY='))).toBe(false);
    const joined = args.join(' ');
    expect(joined).not.toContain('sentinel-gemini-key-2946');
    expect(joined).not.toContain('sentinel-google-key-2946');
  });

  it('still forwards non-secret Vertex/Gemini configuration vars', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    process.env.GEMINI_MODEL = 'gemini-2.5-pro';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    // Parse --env flag/value PAIRS: for each --env take the next element as
    // the operand. This rejects an implementation that emits unpaired values.
    const envPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--env' && i + 1 < args.length) {
        envPairs.push(args[i + 1]);
      }
    }
    expect(envPairs).toContain('GOOGLE_CLOUD_PROJECT=my-project');
    expect(envPairs).toContain('GOOGLE_CLOUD_LOCATION=us-central1');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_VERTEXAI=true');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_GCA=true');
    expect(envPairs).toContain('GEMINI_MODEL=gemini-2.5-pro');
  });

  // Guards against the opposite failure mode: a blanket blocklist keyed on a
  // GEMINI_/GOOGLE_ prefix would drop the secrets but take the non-secret
  // configuration with it. Both kinds must be set at once to catch that.
  it('drops only the secrets when secret and non-secret vars are set together', () => {
    process.env.GEMINI_API_KEY = 'sentinel-gemini-key-2946';
    process.env.GOOGLE_API_KEY = 'sentinel-google-key-2946';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    const envPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--env' && i + 1 < args.length) {
        envPairs.push(args[i + 1]);
      }
    }
    expect(envPairs).toContain('GOOGLE_CLOUD_PROJECT=my-project');
    expect(envPairs).toContain('GOOGLE_CLOUD_LOCATION=us-central1');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_VERTEXAI=true');
    expect(envPairs.some((pair) => pair.startsWith('GEMINI_API_KEY='))).toBe(
      false,
    );
    expect(envPairs.some((pair) => pair.startsWith('GOOGLE_API_KEY='))).toBe(
      false,
    );
    const joined = args.join(' ');
    expect(joined).not.toContain('sentinel-gemini-key-2946');
    expect(joined).not.toContain('sentinel-google-key-2946');
  });

  it('does not mount the gcloud config directory', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gcloud-home-'));
    tempDirs.push(fakeHome);
    fs.mkdirSync(path.join(fakeHome, '.config', 'gcloud'), {
      recursive: true,
    });
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const args: string[] = [];
    addContainerVolumeMounts(args);

    const gcloudPath = path.join(fakeHome, '.config', 'gcloud');
    // Inspect only the operand that follows each --volume flag, so unrelated
    // mounts are permitted while a gcloud mount still fails the test.
    const volumeOperands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--volume' && i + 1 < args.length) {
        volumeOperands.push(args[i + 1]);
      }
    }
    expect(volumeOperands.some((spec) => spec.includes(gcloudPath))).toBe(
      false,
    );
    expect(args.join(' ')).not.toContain(gcloudPath);
  });

  it('does not mount the GOOGLE_APPLICATION_CREDENTIALS file or re-export it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adc-'));
    tempDirs.push(tmpDir);
    const adcFile = path.join(tmpDir, 'service-account.json');
    fs.writeFileSync(adcFile, '{"type":"service_account"}');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args.join(' ')).not.toContain(adcFile);
    expect(
      args.some((arg) => arg.startsWith('GOOGLE_APPLICATION_CREDENTIALS=')),
    ).toBe(false);
  });

  it('still mounts paths from LLXPRT_SANDBOX_MOUNTS (regression guard)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-mount-'));
    tempDirs.push(tmpDir);
    process.env.LLXPRT_SANDBOX_MOUNTS = tmpDir;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args).toContain('--volume');
    expect(args).toContain(`${tmpDir}:${tmpDir}:ro`);
  });

  it('still mounts paths from legacy SANDBOX_MOUNTS name (regression guard)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-mount-'));
    tempDirs.push(tmpDir);
    process.env.SANDBOX_MOUNTS = tmpDir;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args).toContain('--volume');
    expect(args).toContain(`${tmpDir}:${tmpDir}:ro`);
  });
});
