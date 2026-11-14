/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookRunner } from './hookRunner.js';
import type { HookConfig, HookExecutionPlan } from './types.js';
import { HookEventName } from './types.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';
import type { HookSnapshotResult } from './hookOutputSnapshot.js';
import { disposeHookSnapshots } from './hookSnapshotAggregator.js';

async function executeSequential(
  runner: HookRunner,
  configs: readonly HookConfig[],
  input: HookModelRowsInput,
  signal: AbortSignal,
  results: HookSnapshotResult[],
): Promise<void> {
  let current = input;
  for (const config of configs) {
    signal.throwIfAborted();
    const result = await runner.executeHookWithRequestRows(
      config,
      input.hook_event_name,
      current,
      signal,
    );
    results.push(result);
    if (
      input.hook_event_name === HookEventName.BeforeModel &&
      result.success &&
      result.output !== undefined
    )
      current = {
        ...current,
        llm_request: result.output.mergeRequestRows(current.llm_request),
      };
  }
}

async function executeParallel(
  runner: HookRunner,
  configs: readonly HookConfig[],
  input: HookModelRowsInput,
  signal: AbortSignal,
  results: HookSnapshotResult[],
): Promise<void> {
  const cancellation = new AbortController();
  const combined = AbortSignal.any([signal, cancellation.signal]);
  const settled = await Promise.allSettled(
    configs.map(async (config) => {
      try {
        return await runner.executeHookWithRequestRows(
          config,
          input.hook_event_name,
          input,
          combined,
        );
      } catch (error) {
        cancellation.abort(error);
        throw error;
      }
    }),
  );
  let failure: unknown;
  for (const result of settled) {
    if (result.status === 'fulfilled') results.push(result.value);
    else failure ??= result.reason;
  }
  if (failure !== undefined) throw failure;
}

export async function executeHookSnapshotPlan(
  runner: HookRunner,
  plan: HookExecutionPlan,
  input: HookModelRowsInput,
  signal: AbortSignal,
): Promise<HookSnapshotResult[]> {
  const results: HookSnapshotResult[] = [];
  try {
    signal.throwIfAborted();
    const execute = plan.sequential ? executeSequential : executeParallel;
    await execute(runner, plan.hookConfigs, input, signal, results);
    signal.throwIfAborted();
    return results;
  } catch (error) {
    disposeHookSnapshots(results);
    throw error;
  }
}
