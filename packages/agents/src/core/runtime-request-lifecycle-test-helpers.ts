/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  initializeTelemetry,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
  type RuntimeRequestArtifact,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-fixture.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { sourceHeap } from './streamprocessor-source-measurements.js';

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
async function lifecycle(
  directory: string,
  phase: string,
  error?: unknown,
): Promise<void> {
  const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
  if (evidence === undefined) return;
  const path = join(directory, 'runtime.jsonl');
  const existingKind = (): string =>
    statSync(path).isDirectory() ? 'directory' : 'file';
  const kind = existsSync(path) ? existingKind() : 'absent';
  const handles =
    phase.endsWith('after-shutdown') && process.platform === 'darwin'
      ? Bun.spawnSync(['lsof', '-a', '-p', String(process.pid), '-Fn'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
      : undefined;
  if (handles !== undefined && handles.exitCode !== 0)
    throw new Error(handles.stderr.toString());
  const openFixtureFiles = handles?.stdout
    .toString()
    .split('\n')
    .filter((line) => line.startsWith(`n${directory}/`));
  if (openFixtureFiles !== undefined) expect(openFixtureFiles).toHaveLength(0);
  await appendFile(
    join(evidence, `lifecycle-${process.pid}.jsonl`),
    JSON.stringify({
      phase,
      directory,
      path,
      kind,
      initialized: isTelemetrySdkInitialized(),
      openFixtureFiles,
      error:
        error instanceof Error
          ? {
              message: error.message,
              ...('code' in error ? { code: error.code } : {}),
              ...('path' in error ? { path: error.path } : {}),
            }
          : undefined,
    }) + '\n',
  );
}
export async function runtimeWriteFailure(parent: string): Promise<void> {
  const directory = await mkdtemp(join(parent, 'runtime-write-'));
  let active: Config | undefined;
  try {
    expect(isTelemetrySdkInitialized()).toBe(false);
    await lifecycle(directory, 'write-before-setup');
    await mkdir(join(directory, 'runtime.jsonl'));
    active = runtimeConfig(directory);
    initializeTelemetry(active);
    await lifecycle(directory, 'write-after-config');
    await expect(
      sendRuntimeArtifact(await runtimeArtifact(directory), active).catch(
        async (error) => {
          await lifecycle(directory, 'write-rejected', error);
          throw error;
        },
      ),
    ).rejects.toThrow('EISDIR');
  } finally {
    if (active !== undefined) await shutdownTelemetry(active);
    expect(isTelemetrySdkInitialized()).toBe(false);
    await lifecycle(directory, 'write-after-shutdown');
    await rm(directory, { recursive: true });
  }
}
export async function runtimeRelease(parent: string): Promise<void> {
  const directory = await mkdtemp(join(parent, 'runtime-release-'));
  let active: Config | undefined;
  try {
    expect(isTelemetrySdkInitialized()).toBe(false);
    await lifecycle(directory, 'release-before-config');
    active = runtimeConfig(directory);
    initializeTelemetry(active);
    await lifecycle(directory, 'release-after-config');
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
    const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
    if (evidence !== undefined)
      await writeFile(
        join(
          evidence,
          `runtime-release-${process.pid}-${basename(directory)}.json`,
        ),
        JSON.stringify(facts),
      );
    expect(facts.delta).toBeLessThan(1_048_576);
  } finally {
    if (active !== undefined) await shutdownTelemetry(active);
    expect(isTelemetrySdkInitialized()).toBe(false);
    await lifecycle(directory, 'release-after-shutdown');
    await rm(directory, { recursive: true });
  }
}
