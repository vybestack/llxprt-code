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
  deps: RebuildLoopDeps,
  prepareClientReplacement: PrepareClientReplacement,
  readActiveRun: () => ActiveRun | undefined,
): (changed: boolean, signal: AbortSignal) => Promise<PreparedProfileFacade> {
  return (changed, signal) => {
    const active = readActiveRun();
    const run = active?.loop === deps.loopHolder.current ? active : undefined;
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
      deps,
      prepareClientReplacement,
      retirePrior,
    );
  };
}

export async function prepareProfileReplacement(
  providerChanged: boolean,
  signal: AbortSignal,
  deps: RebuildLoopDeps,
  prepareClientReplacement: PrepareClientReplacement,
  retirePrior: (retire: () => Promise<void>) => Promise<void>,
): Promise<PreparedProfileFacade> {
  const replacement = providerChanged
    ? await prepareClientReplacement()
    : undefined;
  const client = replacement?.client ?? deps.resolveClient();
  try {
    signal.throwIfAborted();
    if (replacement) {
      const history = await client.getHistory();
      signal.throwIfAborted();
      await client.startChat(history.length > 0 ? history : undefined);
    }
    signal.throwIfAborted();
    const loop = prepareLoop({
      telemetry: deps.telemetry,
      loopHolder: deps.loopHolder,
      toolSelection: deps.toolSelection,
      readExecutionPolicy: deps.readExecutionPolicy,
      readApprovalMode: deps.readApprovalMode,
      getToolGovernance: deps.getToolGovernance,
      config: deps.config,
      messageBus: deps.messageBus,
      resolveClient: () => client,
      approvalHandler: deps.approvalHandler,
      displayCallbacks: deps.displayCallbacks,
      AgenticLoopCtor: deps.AgenticLoopCtor,
    });
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
