/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from './agent.js';
import { AgentActivationBootstrap } from './activationPreflightState.js';
import type { FromConfigOptions } from './config-types.js';
import type { HostGitHubBrokerOwner } from './host-github-broker-owner.js';
import type { prepareImageConstruction } from './session-image-assembly.js';

type ImageConstruction = ReturnType<typeof prepareImageConstruction>;

function rejections(results: ReadonlyArray<PromiseSettledResult<unknown>>) {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

function closeActivationPreflight(options: FromConfigOptions): Promise<void> {
  return options.activationPreflight === undefined
    ? Promise.resolve()
    : AgentActivationBootstrap.close(options.activationPreflight.operation);
}

/**
 * Releases every construction owner after a failed adoption. The activation
 * preflight is released last, and any cleanup failure is attached to the
 * primary error instead of replacing it.
 */
export async function cleanupFailedFromConfig(
  primaryError: unknown,
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
  images: ImageConstruction,
): Promise<never> {
  const ownerCleanup = await Promise.allSettled([
    github?.cleanupFailedConstruction(),
    images.cleanupFailedConstruction(),
    options.definitionOwnership === 'agent'
      ? options.definitionOwner?.dispose()
      : undefined,
    options.memoryOwner?.ownership === 'agent'
      ? options.memoryOwner.owner.dispose()
      : undefined,
  ]);
  const preflightCleanup = await Promise.allSettled([
    closeActivationPreflight(options),
  ]);
  const failures = rejections([...ownerCleanup, ...preflightCleanup]);
  if (failures.length > 0)
    throw new AggregateError(
      [primaryError, ...failures],
      'fromConfig ownership cleanup failed',
    );
  throw primaryError;
}

/**
 * Releases the consumed preflight after a successful adoption. When that
 * release fails the adopted agent is disposed so it does not leak.
 */
export async function closePreflightAfterAdoption(
  options: FromConfigOptions,
  agent: Agent,
): Promise<void> {
  try {
    await closeActivationPreflight(options);
  } catch (closeError) {
    const agentCleanup = await Promise.allSettled([agent.dispose()]);
    const failures = rejections(agentCleanup);
    if (failures.length > 0)
      throw new AggregateError(
        [closeError, ...failures],
        'fromConfig preflight cleanup failed',
      );
    throw closeError;
  }
}
