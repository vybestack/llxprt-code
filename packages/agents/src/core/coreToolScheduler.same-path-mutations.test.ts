/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for same-path mutation ordering in CoreToolScheduler
 * batches (issue #3239), using deterministic path-controlled tools.
 *
 * File-mutating tools perform whole-file read-modify-write operations, so two
 * concurrent calls whose target locations overlap can both read the same
 * snapshot and overwrite each other. These tests prove that mutating calls
 * (Kind.Edit/Delete/Move with overlapping normalized toolLocations) execute
 * in request order within one batch, that independent paths stay concurrent,
 * and that failure/abort semantics are preserved.
 */

import { describe, it, expect } from 'bun:test';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import type { ToolCall } from './coreToolScheduler.js';
import { Kind } from '@vybestack/llxprt-code-tools';
import {
  deferred,
  type Deferred,
  nextMacrotask,
  PathControlledTool,
  gatedJournalExecute,
  barrierJournalExecute,
  failingJournalExecute,
  toolRequest,
  buildRegistry,
  buildScheduler,
  trackPublicationOrder,
} from './coreToolScheduler-same-path-mutations-helpers.js';

describe('CoreToolScheduler same-path mutation ordering', () => {
  it('holds a later same-path mutation until the earlier one settles', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    for (const callId of ['m1', 'm2']) {
      gates.set(callId, deferred<void>());
    }
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const publication = trackPublicationOrder();
    const scheduler = buildScheduler(buildRegistry([tool]), {
      onToolCallsUpdate: publication.onToolCallsUpdate,
    });

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/notes.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/notes.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    await nextMacrotask();
    expect(events).toStrictEqual(['start:m1']);

    gates.get('m1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m2');
    });
    gates.get('m2')?.resolve();
    await schedulePromise;

    expect(events).toStrictEqual(['start:m1', 'end:m1', 'start:m2', 'end:m2']);
    expect(publication.order).toStrictEqual(['m1', 'm2']);
  });

  it('executes a three-call same-path chain strictly in request order', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    for (const callId of ['m1', 'm2', 'm3']) {
      gates.set(callId, deferred<void>());
    }
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const scheduler = buildScheduler(buildRegistry([tool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/chain.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/chain.txt'],
        }),
        toolRequest('m3', 'controlledEdit', {
          call: 'm3',
          paths: ['/workspace/chain.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    await nextMacrotask();
    expect(events).toStrictEqual(['start:m1']);

    gates.get('m1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m2');
    });
    await nextMacrotask();
    expect(events).not.toContain('start:m3');

    gates.get('m2')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m3');
    });
    gates.get('m3')?.resolve();
    await schedulePromise;

    expect(events).toStrictEqual([
      'start:m1',
      'end:m1',
      'start:m2',
      'end:m2',
      'start:m3',
      'end:m3',
    ]);
  });

  it('keeps mutations on different paths concurrent', async () => {
    const events: string[] = [];
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      barrierJournalExecute(events, ['m1', 'm2']),
    );
    const scheduler = buildScheduler(buildRegistry([tool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/a.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/b.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await schedulePromise;
    expect(events).toContain('start:m1');
    expect(events).toContain('start:m2');
  });

  it('waits for every earlier mutation that overlaps any location', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    for (const callId of ['m1', 'm2', 'm3']) {
      gates.set(callId, deferred<void>());
    }
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const scheduler = buildScheduler(buildRegistry([tool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/one.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/two.txt', '/workspace/one.txt'],
        }),
        toolRequest('m3', 'controlledEdit', {
          call: 'm3',
          paths: ['/workspace/two.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    await nextMacrotask();
    expect(events).toStrictEqual(['start:m1']);

    gates.get('m1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m2');
    });
    await nextMacrotask();
    expect(events).not.toContain('start:m3');

    gates.get('m2')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m3');
    });
    gates.get('m3')?.resolve();
    await schedulePromise;
  });

  it('orders different path spellings that normalize to one location', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    for (const callId of ['m1', 'm2']) {
      gates.set(callId, deferred<void>());
    }
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const scheduler = buildScheduler(buildRegistry([tool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/shared/../shared/notes.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/shared/notes.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    await nextMacrotask();
    expect(events).toStrictEqual(['start:m1']);

    gates.get('m1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m2');
    });
    gates.get('m2')?.resolve();
    await schedulePromise;
    expect(events).toStrictEqual(['start:m1', 'end:m1', 'start:m2', 'end:m2']);
  });

  it('orders Kind.Delete and Kind.Move calls on the same path', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    gates.set('d1', deferred<void>());
    const deleteTool = new PathControlledTool(
      'controlledDelete',
      Kind.Delete,
      gatedJournalExecute(events, gates),
    );
    const moveTool = new PathControlledTool(
      'controlledMove',
      Kind.Move,
      gatedJournalExecute(events, new Map()),
    );
    const scheduler = buildScheduler(buildRegistry([deleteTool, moveTool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('d1', 'controlledDelete', {
          call: 'd1',
          paths: ['/workspace/target.txt'],
        }),
        toolRequest('mv1', 'controlledMove', {
          call: 'mv1',
          paths: ['/workspace/target.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:d1');
    });
    await nextMacrotask();
    expect(events).not.toContain('start:mv1');

    gates.get('d1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:mv1');
    });
    await schedulePromise;
  });

  it('does not start a waiting mutation after the batch aborts', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    gates.set('m1', deferred<void>());
    const tool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const publication = trackPublicationOrder();
    const terminalStatuses: Record<string, ToolCall['status']> = {};
    const scheduler = buildScheduler(buildRegistry([tool]), {
      onToolCallsUpdate: (calls) => {
        publication.onToolCallsUpdate(calls);
        for (const call of calls) {
          if (
            call.status === 'success' ||
            call.status === 'error' ||
            call.status === 'cancelled'
          ) {
            terminalStatuses[call.request.callId] = call.status;
          }
        }
      },
    });

    const abortController = new AbortController();
    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/abort.txt'],
        }),
        toolRequest('m2', 'controlledEdit', {
          call: 'm2',
          paths: ['/workspace/abort.txt'],
        }),
      ],
      abortController.signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    abortController.abort();
    gates.get('m1')?.resolve();

    await schedulePromise;
    await nextMacrotask();
    // The waiting mutation never begins side effects after the abort.
    expect(events).toStrictEqual(['start:m1', 'end:m1']);
    // Both calls still reach a terminal state.
    expect(terminalStatuses['m1']).toBe('cancelled');
    expect(terminalStatuses['m2']).toBe('cancelled');

    // The aborted batch must not corrupt the scheduler's ordered-result
    // bookkeeping: the same scheduler still publishes a later batch's
    // result to terminal success.
    const followUpPromise = scheduler.schedule(
      [
        toolRequest('n1', 'controlledEdit', {
          call: 'n1',
          paths: ['/workspace/after-abort.txt'],
        }),
      ],
      new AbortController().signal,
    );
    await waitFor(() => {
      expect(terminalStatuses['n1']).toBe('success');
    });
    await followUpPromise;
    expect(events).toStrictEqual(['start:m1', 'end:m1', 'start:n1', 'end:n1']);
    expect(publication.order).toStrictEqual(['n1']);
  });

  it('still executes and publishes a later same-path call after an earlier failure', async () => {
    const events: string[] = [];
    const gates = new Map<string, Deferred<void>>();
    gates.set('m1', deferred<void>());
    gates.set('m2', deferred<void>());
    const failingTool = new PathControlledTool(
      'controlledFailingEdit',
      Kind.Edit,
      failingJournalExecute(events, gates),
    );
    const succeedingTool = new PathControlledTool(
      'controlledSucceedingEdit',
      Kind.Edit,
      gatedJournalExecute(events, gates),
    );
    const publication = trackPublicationOrder();
    const terminalStatuses: Record<string, ToolCall['status']> = {};
    const scheduler = buildScheduler(
      buildRegistry([failingTool, succeedingTool]),
      {
        onToolCallsUpdate: (calls) => {
          publication.onToolCallsUpdate(calls);
          for (const call of calls) {
            if (
              call.status === 'success' ||
              call.status === 'error' ||
              call.status === 'cancelled'
            ) {
              terminalStatuses[call.request.callId] = call.status;
            }
          }
        },
      },
    );

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledFailingEdit', {
          call: 'm1',
          paths: ['/workspace/failure.txt'],
        }),
        toolRequest('m2', 'controlledSucceedingEdit', {
          call: 'm2',
          paths: ['/workspace/failure.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await waitFor(() => {
      expect(events).toContain('start:m1');
    });
    await nextMacrotask();
    expect(events).not.toContain('start:m2');

    gates.get('m1')?.resolve();
    await waitFor(() => {
      expect(events).toContain('start:m2');
    });
    gates.get('m2')?.resolve();
    await schedulePromise;

    expect(terminalStatuses['m1']).toBe('error');
    expect(terminalStatuses['m2']).toBe('success');
    expect(publication.order).toStrictEqual(['m1', 'm2']);
  });

  it('keeps read-kind calls concurrent with a same-path mutation', async () => {
    const events: string[] = [];
    const barrier = barrierJournalExecute(events, ['r1', 'e1']);
    const readTool = new PathControlledTool(
      'controlledRead',
      Kind.Read,
      barrier,
    );
    const editTool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      barrier,
    );
    const scheduler = buildScheduler(buildRegistry([readTool, editTool]));

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('r1', 'controlledRead', {
          call: 'r1',
          paths: ['/workspace/read-vs-write.txt'],
        }),
        toolRequest('e1', 'controlledEdit', {
          call: 'e1',
          paths: ['/workspace/read-vs-write.txt'],
        }),
      ],
      new AbortController().signal,
    );

    await schedulePromise;
    expect(events).toContain('start:r1');
    expect(events).toContain('start:e1');
  });

  it('keeps location-less mutating calls concurrent', async () => {
    const events: string[] = [];
    const barrier = barrierJournalExecute(events, ['m1', 'm2']);
    const anchoredTool = new PathControlledTool(
      'controlledEdit',
      Kind.Edit,
      barrier,
    );
    const locationlessTool = new PathControlledTool(
      'controlledLocationlessEdit',
      Kind.Edit,
      barrier,
    );
    const scheduler = buildScheduler(
      buildRegistry([anchoredTool, locationlessTool]),
    );

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('m1', 'controlledEdit', {
          call: 'm1',
          paths: ['/workspace/anchored.txt'],
        }),
        toolRequest('m2', 'controlledLocationlessEdit', {
          call: 'm2',
          paths: [],
        }),
      ],
      new AbortController().signal,
    );

    await schedulePromise;
    expect(events).toContain('start:m1');
    expect(events).toContain('start:m2');
  });
});
