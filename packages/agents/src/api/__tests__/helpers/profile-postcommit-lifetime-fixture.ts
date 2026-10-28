/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import { realpath } from 'node:fs/promises';

import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { releaseAdoptedFileScope } from '../../adoption-release.js';

import { runCleanupSteps } from '../../../core/subagent-cleanup.js';

import { expect } from 'bun:test';

import type { executeProviderActivation } from '../../providerActivationExecutor.js';

import { type Agent } from '@vybestack/llxprt-code-agents';

export function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export async function boundary(
  promise: Promise<void>,
  name: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach ${name}`)),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function observe<T>(promise: Promise<T>): {
  settled: () => boolean;
  result: Promise<{ value: T } | { error: unknown }>;
} {
  let settled = false;
  const result = promise.then(
    (value) => {
      settled = true;
      return { value };
    },
    (error: unknown) => {
      settled = true;
      return { error };
    },
  );
  return { settled: () => settled, result };
}
export async function successfulTurn(agent: Agent): Promise<void> {
  const events = [];
  for await (const event of agent.stream('continue independently', {
    mcpDiscovery: 'skip',
  }))
    events.push(event);
  expect(events.filter((event) => event.type === 'error')).toStrictEqual([]);
  expect(events.filter((event) => event.type === 'done')).toStrictEqual([
    { type: 'done', reason: 'stop' },
  ]);
}
export function restoreEnvironment(
  environment: ReadonlyMap<string, string | undefined>,
): void {
  for (const [key, value] of environment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
export async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}
export function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
export function seedCallerSettings(
  config: Config,
  settings: SettingsService,
): void {
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
}
export function acquireCallerFileScopes(
  release: AcquisitionRelease,
  files: ProviderFileLifecycle,
  runtimeId: string,
  sessionId: string,
): void {
  for (const scope of [runtimeId, sessionId])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
}
export async function callerWorkingDirectory(
  directory: string | undefined,
  fallback: string,
): Promise<string> {
  return directory === undefined ? fallback : realpath(directory);
}
export function includeCallerCwd(
  directories: readonly string[] | undefined,
): string[] {
  return [...(directories ?? []), process.cwd()];
}
