/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  initializeTelemetry,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
  type RuntimeRequestArtifact,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { sourceHeap } from './__tests__/support/streamprocessor-source-measurements.js';

export function runtimeConfig(
  directory: string,
  cap = 4000,
  enabled = true,
): Config {
  return new Config({
    cwd: directory,
    targetDir: directory,
    sessionId: 'artifact-runtime',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: enabled,
      logApiBodies: enabled,
      logApiBodyMaxChars: cap,
      outfile: join(directory, 'runtime.jsonl'),
    },
  });
}
export async function runtimeArtifact(
  directory: string,
  large = false,
): Promise<RuntimeRequestArtifact> {
  return {
    schema_version: 3,
    serialization: 'independent-safe-json-rows-v1',
    source: await stageTurnRequestArtifact(
      directory,
      (async function* () {
        for (let index = 0; index < 64; index++)
          yield diskTextRow(index, large);
      })(),
    ),
  };
}
export async function sendRuntimeArtifact(
  staged: RuntimeRequestArtifact,
  active: Config,
  signal?: AbortSignal,
): Promise<void> {
  await createTelemetryAdapterFromConfig(active).logApiRequest({
    model: 'gpt-5.6',
    runtimeId: 'runtime-fallback',
    requestArtifact: staged,
    signal,
  });
}
function expectNoOpenFixtureFiles(directory: string): void {
  if (process.platform !== 'darwin') return;
  const handles = Bun.spawnSync(
    ['lsof', '-a', '-p', String(process.pid), '-Fn'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (handles.exitCode !== 0) throw new Error(handles.stderr.toString());
  const openFixtureFiles = handles.stdout
    .toString()
    .split('\n')
    .filter((line) => line.startsWith(`n${directory}/`));
  expect(openFixtureFiles).toHaveLength(0);
}
export async function runtimeWriteFailure(parent: string): Promise<void> {
  const directory = await mkdtemp(join(parent, 'runtime-write-'));
  let active: Config | undefined;
  try {
    expect(isTelemetrySdkInitialized()).toBe(false);
    await mkdir(join(directory, 'runtime.jsonl'));
    active = runtimeConfig(directory);
    initializeTelemetry(active);
    await expect(
      sendRuntimeArtifact(await runtimeArtifact(directory), active),
    ).rejects.toThrow('EISDIR');
  } finally {
    if (active !== undefined) await shutdownTelemetry(active);
    expect(isTelemetrySdkInitialized()).toBe(false);
    expectNoOpenFixtureFiles(directory);
    await rm(directory, { recursive: true });
  }
}
export async function runtimeRelease(parent: string): Promise<void> {
  const directory = await mkdtemp(join(parent, 'runtime-release-'));
  let active: Config | undefined;
  try {
    expect(isTelemetrySdkInitialized()).toBe(false);
    active = runtimeConfig(directory);
    initializeTelemetry(active);
    await sendRuntimeArtifact(await runtimeArtifact(directory), active);
    const staged = await runtimeArtifact(directory, true);
    const baseline = await sourceHeap();
    await sendRuntimeArtifact(staged, active);
    const settled = await sourceHeap();
    const facts = {
      baseline,
      settled,
      delta: settled - baseline,
      content_bytes: staged.source.content_bytes,
    };
    expect(facts.delta).toBeLessThan(1_048_576);
  } finally {
    if (active !== undefined) await shutdownTelemetry(active);
    expect(isTelemetrySdkInitialized()).toBe(false);
    expectNoOpenFixtureFiles(directory);
    await rm(directory, { recursive: true });
  }
}
