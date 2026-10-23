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

export class ForegroundRunLifecycle {
  constructor(
    private readonly recording: AgentChatRecordingExecution,
    private readonly isApplying: () => boolean,
    private readonly isReady: () => boolean,
    private readonly admitRun: (run: ActiveRun) => void,
    private readonly releaseRun: (run: ActiveRun) => void,
    private readonly resolveLoop: () =>
      | { loop: NonNullable<ActiveRun['loop']>; error?: undefined }
      | { loop?: undefined; error: { message: string } },
    private readonly admitParameters: () => AdmittedModelParameters | undefined,
    private readonly awaitDiscovery: () => Promise<ReadonlyMap<string, string>>,
    private readonly notifyConfirmation: ToolControl['notifyConfirmation'],
    private readonly notifyToolUpdate: ToolControl['notifyToolUpdate'],
  ) {}

  stream(input: AgentInput, opts?: TurnOptions): AsyncIterable<AgentEvent> {
    const iterator = this.execute(input, opts, async () => {
      await iterator.return(undefined);
    });
    return iterator;
  }

  private async *execute(
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
    if (this.isApplying()) throw new AgentBusyError();
    this.admitRun(run);
    try {
      yield* this.streamAdmitted(
        run,
        structuredClone(input),
        opts === undefined ? undefined : { ...opts },
      );
    } finally {
      try {
        await finishRun(run);
      } finally {
        this.releaseRun(run);
      }
    }
  }

  private async *streamAdmitted(
    run: ActiveRun,
    input: AgentInput,
    opts?: TurnOptions,
  ): AsyncGenerator<AgentEvent> {
    if (!this.isReady()) {
      yield { type: 'error', error: { message: UNCONFIGURED_AGENT_MESSAGE } };
      yield { type: 'done', reason: 'error' };
      return;
    }
    const init = this.resolveLoop();
    if (init.error !== undefined) {
      yield { type: 'error', error: init.error };
      yield { type: 'done', reason: 'error' };
      return;
    }
    run.loop = init.loop;
    run.modelParameters = this.admitParameters();
    const effectiveSignal = opts?.signal
      ? AbortSignal.any([opts.signal, run.controller.signal])
      : run.controller.signal;
    const discoveryFailures =
      opts?.mcpDiscovery === 'skip'
        ? new Map<string, string>()
        : await this.awaitDiscovery();
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
        ...this.recording,
        hookOwner:
          this.recording.hookOwner === undefined
            ? undefined
            : {
                ...this.recording.hookOwner,
                signal:
                  this.recording.hookOwner.signal === undefined
                    ? effectiveSignal
                    : AbortSignal.any([
                        this.recording.hookOwner.signal,
                        effectiveSignal,
                      ]),
              },
      },
      run.modelParameters,
    );
    for await (const event of mapLoopStream(loopEvents)) {
      if (event.type === 'tool-confirmation') {
        this.notifyConfirmation(event.confirmation);
      } else if (event.type === 'tool-status') {
        this.notifyToolUpdate(event.update);
      }
      yield event;
    }
  }
}
