/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { ActiveRun } from './directProviderAdmission.js';
import type { AgentInput, TurnOptions } from './agent.js';
import type { AgentEvent } from './event-types.js';
import type { ToolControl } from './control/toolControl.js';
import { AgentBusyError } from './loop/agentBusyError.js';
import { mapLoopStream } from './eventAdapter.js';
import { toPartListUnion } from './agentBootstrap.js';

const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';

export interface ForegroundRunOwner {
  readonly recording: AgentChatRecordingExecution;
  isApplying(): boolean;
  isReady(): boolean;
  admitRun(run: ActiveRun): void;
  releaseRun(run: ActiveRun): void;
  resolveLoop():
    | { loop: NonNullable<ActiveRun['loop']>; error?: undefined }
    | { loop?: undefined; error: { message: string } };
  admitParameters(): AdmittedModelParameters | undefined;
  awaitDiscovery(): Promise<ReadonlyMap<string, string>>;
  notifyConfirmation(
    confirmation: Parameters<ToolControl['notifyConfirmation']>[0],
  ): void;
  notifyToolUpdate(
    update: Parameters<ToolControl['notifyToolUpdate']>[0],
  ): void;
}

async function finishRun(run: ActiveRun): Promise<void> {
  run.controller.abort();
  try {
    const results = await Promise.allSettled(
      run.retirements.map((retire) => retire()),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Admitted profile retirement failed',
      );
    }
  } finally {
    run.finish();
  }
}

export function streamForegroundRun(
  owner: ForegroundRunOwner,
  input: AgentInput,
  opts?: TurnOptions,
): AsyncIterable<AgentEvent> {
  const iterator = executeForegroundRun(owner, input, opts, async () => {
    await iterator.return(undefined);
  });
  return iterator;
}

export async function* executeForegroundRun(
  owner: ForegroundRunOwner,
  input: AgentInput,
  opts: TurnOptions | undefined,
  close: () => Promise<void>,
): AsyncGenerator<AgentEvent> {
  let finish = (): void => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const run: ActiveRun = {
    controller: new AbortController(),
    finished,
    finish,
    close,
    retirements: [],
  };
  if (owner.isApplying()) throw new AgentBusyError();
  owner.admitRun(run);
  try {
    yield* streamAdmitted(owner, run, input, opts);
  } finally {
    try {
      await finishRun(run);
    } finally {
      owner.releaseRun(run);
    }
  }
}

async function* streamAdmitted(
  owner: ForegroundRunOwner,
  run: ActiveRun,
  input: AgentInput,
  opts?: TurnOptions,
): AsyncGenerator<AgentEvent> {
  if (!owner.isReady()) {
    yield { type: 'error', error: { message: UNCONFIGURED_AGENT_MESSAGE } };
    yield { type: 'done', reason: 'error' };
    return;
  }
  const init = owner.resolveLoop();
  if (init.error !== undefined) {
    yield { type: 'error', error: init.error };
    yield { type: 'done', reason: 'error' };
    return;
  }
  run.loop = init.loop;
  run.modelParameters = owner.admitParameters();
  const effectiveSignal = opts?.signal
    ? AbortSignal.any([opts.signal, run.controller.signal])
    : run.controller.signal;
  const discoveryFailures =
    opts?.mcpDiscovery === 'skip'
      ? new Map<string, string>()
      : await owner.awaitDiscovery();
  for (const [server, message] of discoveryFailures.entries()) {
    yield {
      type: 'notice',
      message: `MCP server '${server}' discovery failed: ${message}`,
    };
  }
  if (effectiveSignal.aborted) {
    yield { type: 'done', reason: 'aborted' };
    return;
  }
  const loopEvents = init.loop.run(
    toPartListUnion(input),
    effectiveSignal,
    opts?.promptId,
    {
      ...owner.recording,
      hookOwner:
        owner.recording.hookOwner === undefined
          ? undefined
          : {
              ...owner.recording.hookOwner,
              signal:
                owner.recording.hookOwner.signal === undefined
                  ? effectiveSignal
                  : AbortSignal.any([
                      owner.recording.hookOwner.signal,
                      effectiveSignal,
                    ]),
            },
    },
    run.modelParameters,
  );
  for await (const event of mapLoopStream(loopEvents)) {
    if (event.type === 'tool-confirmation') {
      owner.notifyConfirmation(event.confirmation);
    } else if (event.type === 'tool-status') {
      owner.notifyToolUpdate(event.update);
    }
    yield event;
  }
}
