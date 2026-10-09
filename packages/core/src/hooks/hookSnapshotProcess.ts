/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ChildProcess } from 'node:child_process';
import {
  startHookInputStream,
  stopHookInputProcess,
  type HookModelRowsInput,
  type HookInputStream,
} from './hookModelInputStream.js';
import type {
  HookOutputOwner,
  HookSnapshotResult,
} from './hookOutputSnapshot.js';
import type { HookConfig, HookEventName } from './types.js';

interface ProcessOptions {
  readonly hookConfig: HookConfig;
  readonly eventName: HookEventName;
  readonly input: HookModelRowsInput;
  readonly signal?: AbortSignal;
  readonly startTime: number;
  readonly timeout: number;
  readonly spawn: () => ChildProcess;
  readonly killTimeout: (
    child: ChildProcess,
    expired: () => void,
  ) => { clear(): void };
}

export function snapshotFailure(
  owner: HookOutputOwner,
  options: Pick<ProcessOptions, 'hookConfig' | 'eventName' | 'startTime'>,
  error: Error,
): HookSnapshotResult {
  return {
    kind: 'disk-hook-output',
    hookConfig: options.hookConfig,
    eventName: options.eventName,
    success: false,
    error,
    duration: Date.now() - options.startTime,
    stdout: owner.stdout,
    stderr: owner.stderr,
    dispose: () => owner.dispose(),
  };
}

export async function runHookSnapshot(
  options: ProcessOptions,
  owner: HookOutputOwner,
): Promise<HookSnapshotResult> {
  let child: ChildProcess;
  try {
    child = options.spawn();
  } catch (error) {
    return snapshotFailure(
      owner,
      options,
      error instanceof Error
        ? error
        : new Error('Hook spawn failed', { cause: error }),
    );
  }
  return readHookSnapshot(options, owner, child);
}

async function readHookSnapshot(
  options: ProcessOptions,
  owner: HookOutputOwner,
  child: ChildProcess,
): Promise<HookSnapshotResult> {
  const state: { diskError?: unknown; timedOut: boolean } = { timedOut: false };
  const drain = (stream: 'stdout' | 'stderr', bytes: Buffer): void => {
    try {
      owner[stream].append(bytes);
    } catch (error) {
      state.diskError ??= error;
      stopHookInputProcess(child, 'SIGKILL');
    }
  };
  child.stdout?.on('data', (bytes: Buffer) => drain('stdout', bytes));
  child.stderr?.on('data', (bytes: Buffer) => drain('stderr', bytes));
  const exited = new Promise<{ code: number | null; error?: Error }>(
    (resolve) => {
      let spawnError: Error | undefined;
      child.on('error', (error) => {
        spawnError = error;
      });
      child.on('close', (code) => resolve({ code, error: spawnError }));
    },
  );
  let inputStream: HookInputStream | undefined;
  let control: { clear(): void } | undefined;
  try {
    const stream = startHookInputStream(child, options.input, options.signal);
    inputStream = stream;
    control = options.killTimeout(child, () => {
      state.timedOut = true;
      stream.cancel(
        new Error(`Hook timed out after ${options.timeout}ms`),
        false,
      );
    });
    const exit = await exited;
    control.clear();
    const inputError = await inputStream.close();
    if (state.diskError !== undefined) throw state.diskError;
    const failure = state.timedOut
      ? new Error(`Hook timed out after ${options.timeout}ms`)
      : (exit.error ?? inputError);
    const output = state.timedOut ? undefined : owner.output(exit.code);
    return {
      kind: 'disk-hook-output',
      hookConfig: options.hookConfig,
      eventName: options.eventName,
      success: failure === undefined && exit.code === 0,
      output,
      error: failure,
      exitCode: state.timedOut || exit.code === null ? undefined : exit.code,
      duration: Date.now() - options.startTime,
      stdout: owner.stdout,
      stderr: owner.stderr,
      dispose: () => owner.dispose(),
    };
  } catch (error) {
    try {
      if (child.exitCode === null && child.signalCode === null)
        stopHookInputProcess(child, 'SIGKILL');
      await exited;
      await inputStream?.close();
    } finally {
      owner.dispose();
    }
    throw error;
  } finally {
    control?.clear();
  }
}
