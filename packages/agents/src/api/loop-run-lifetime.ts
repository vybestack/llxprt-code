/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgenticLoopRunner,
  AgenticLoopEvent,
  AgenticLoopMessage,
} from './runtimeFactories.js';

interface AcceptedRun {
  readonly iterator: AsyncGenerator<AgenticLoopEvent>;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}

export class LoopRunLifetime implements AgenticLoopRunner {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly active = new Set<AcceptedRun>();

  constructor(
    private readonly execute: AgenticLoopRunner['run'],
    private readonly release: () => Promise<void>,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new Error('Agentic loop runner is closed');
  }

  run(
    message: AgenticLoopMessage,
    signal: AbortSignal,
    promptId?: string,
  ): AsyncGenerator<AgenticLoopEvent> {
    this.assertOpen();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const iterator = this.iterate(
      message,
      combined,
      promptId,
      () => accepted,
      settle,
    );
    const accepted: AcceptedRun = { iterator, controller, settled };
    return iterator;
  }

  private async *iterate(
    message: AgenticLoopMessage,
    signal: AbortSignal,
    promptId: string | undefined,
    readAccepted: () => AcceptedRun,
    settle: () => void,
  ): AsyncGenerator<AgenticLoopEvent> {
    this.assertOpen();
    const accepted = readAccepted();
    this.active.add(accepted);
    try {
      yield* this.execute(message, signal, promptId);
    } finally {
      settle();
      this.active.delete(accepted);
    }
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    const runs = [...this.active];
    for (const run of runs) run.controller.abort();
    const returns = Promise.allSettled(
      runs.map((run) => run.iterator.return(undefined)),
    );
    this.closing = (async () => {
      const finalizers = await returns;
      await Promise.all(runs.map((run) => run.settled));
      const [resources] = await Promise.allSettled([
        Promise.resolve().then(this.release),
      ]);
      const failures = [...finalizers, resources].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Agentic loop runner cleanup failed',
        );
    })();
    return this.closing;
  }
}
