/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type RetirementStep = () => Promise<void> | undefined;

export interface ActivationOwnerRetirement {
  /** Settles once admitted public work and the construction tail have ended. */
  readonly publicWork: Promise<unknown>;
  /** Memory disposal, started when the activation closed. */
  readonly memory: Promise<void> | undefined;
  /** Disposes the pre-Agent session client. */
  readonly sessionClient: RetirementStep;
  /**
   * Owners that retire together once the client has settled: definitions,
   * media, trust cleanup and filesystem.
   */
  readonly afterClient: readonly RetirementStep[];
  /** Disposes the settings owner; only a transferred owner retires here. */
  readonly settings: RetirementStep;
}

function rejections(results: ReadonlyArray<PromiseSettledResult<unknown>>) {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

/**
 * Retires the activation owners in dependency order: public work, memory, the
 * session client, then the remaining owners together, then settings. Every
 * step runs even when an earlier one fails; failures are reported together as
 * client, memory, remaining owners, settings.
 */
export async function retireActivationOwners(
  owners: ActivationOwnerRetirement,
): Promise<void> {
  await owners.publicWork;
  const memoryCleanup = await Promise.allSettled([owners.memory]);
  const clientCleanup = await Promise.allSettled([owners.sessionClient()]);
  const afterClientCleanup = await Promise.allSettled(
    owners.afterClient.map((retire) => retire()),
  );
  const failures = [
    ...rejections(clientCleanup),
    ...rejections(memoryCleanup),
    ...rejections(afterClientCleanup),
  ];
  const settingsCleanup = await Promise.allSettled([owners.settings()]);
  failures.push(...rejections(settingsCleanup));
  if (failures.length > 0)
    throw new AggregateError(failures, 'Activation owner cleanup failed');
}
