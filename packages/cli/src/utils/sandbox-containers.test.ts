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
} from './sandbox-containers.js';

vi.mock('node:child_process');

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
