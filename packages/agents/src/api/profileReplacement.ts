/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { prepareLoop, type RebuildLoopDeps } from './loop/rebuildLoop.js';
import type { ActiveRun } from './directProviderAdmission.js';
import type { PreparedProfileFacade } from './profileApplicationAssembly.js';

type PrepareClientReplacement = () => Promise<{
  client: ReturnType<RebuildLoopDeps['resolveClient']>;
  prepareHistoryCommit: () => Promise<() => void>;
  publish: () => void;
  retire: () => Promise<void>;
  discard: () => Promise<void>;
}>;

export function assembleProfileReplacement(
  resolveClient: RebuildLoopDeps['resolveClient'],
  telemetry: RebuildLoopDeps['telemetry'],
  loopHolder: RebuildLoopDeps['loopHolder'],
  toolSelection: RebuildLoopDeps['toolSelection'],
  readApprovalMode: RebuildLoopDeps['readApprovalMode'],
  readExecutionPolicy: RebuildLoopDeps['readExecutionPolicy'],
  getToolGovernance: RebuildLoopDeps['getToolGovernance'],
  config: RebuildLoopDeps['config'],
  messageBus: RebuildLoopDeps['messageBus'],
  approvalHandler: RebuildLoopDeps['approvalHandler'],
  displayCallbacks: RebuildLoopDeps['displayCallbacks'],
  prepareClientReplacement: PrepareClientReplacement,
  readActiveRun: () => ActiveRun | undefined,
): (changed: boolean, signal: AbortSignal) => Promise<PreparedProfileFacade> {
  return (changed, signal) => {
    const active = readActiveRun();
    const run = active?.loop === loopHolder.current ? active : undefined;
    const retirePrior = (retire: () => Promise<void>): Promise<void> => {
      if (run !== undefined && readActiveRun() === run) {
        run.retirements = [...run.retirements, retire];
        return Promise.resolve();
      }
      return retire();
    };
    return prepareProfileReplacement(
      changed,
      signal,
      resolveClient,
      (client) =>
        prepareLoop({
          telemetry,
          loopHolder,
          toolSelection,
          readApprovalMode,
          readExecutionPolicy,
          getToolGovernance,
          config,
          messageBus,
          resolveClient: () => client,
          approvalHandler,
          displayCallbacks,
        }),
      prepareClientReplacement,
      retirePrior,
    );
  };
}

export async function prepareProfileReplacement(
  providerChanged: boolean,
  signal: AbortSignal,
  resolveClient: RebuildLoopDeps['resolveClient'],
  prepareLoopForClient: (
    client: ReturnType<RebuildLoopDeps['resolveClient']>,
  ) => ReturnType<typeof prepareLoop>,
  prepareClientReplacement: PrepareClientReplacement,
  retirePrior: (retire: () => Promise<void>) => Promise<void>,
): Promise<PreparedProfileFacade> {
  const replacement = providerChanged
    ? await prepareClientReplacement()
    : undefined;
  const client = replacement?.client ?? resolveClient();
  try {
    signal.throwIfAborted();
    if (replacement) {
      const history = await client.getHistory();
      signal.throwIfAborted();
      await client.startChat(history.length > 0 ? history : undefined);
    }
    signal.throwIfAborted();
    const loop = prepareLoopForClient(client);
    const commitHistory = await replacement?.prepareHistoryCommit();
    signal.throwIfAborted();
    return {
      publish: () => {
        commitHistory?.();
        replacement?.publish();
        loop.publish();
      },
      retire: () =>
        retirePrior(async () => {
          const failures: unknown[] = [];
          try {
            loop.retire();
          } catch (error) {
            failures.push(error);
          }
          try {
            await replacement?.retire();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length > 0)
            throw new AggregateError(
              failures,
              'Profile replacement retirement failed',
            );
        }),
      discard: async () => {
        await replacement?.discard();
      },
    };
  } catch (error) {
    try {
      await replacement?.discard();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Profile preparation failed and candidate cleanup was incomplete',
      );
    }
    throw error;
  }
}
