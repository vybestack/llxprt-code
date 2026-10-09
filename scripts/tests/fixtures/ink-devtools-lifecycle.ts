/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { gcAndSweep } from 'bun:jsc';
import { z } from 'zod';

const nodes = new Map<number, { name: string; parent: number }>();
let operationBatches = 0;
let inspectedText: string | undefined;
let profilingCommits = 0;
const messageSchema = z.object({ event: z.string(), payload: z.unknown() });
const inspectionSchema = z.object({
  value: z.object({
    props: z.object({ data: z.object({ text: z.string() }) }),
  }),
});

function applyOperations(operations: number[]): void {
  operationBatches++;
  const strings = [''];
  const stringEnd = 3 + operations[2];
  let cursor = 3;
  while (cursor < stringEnd) {
    const length = operations[cursor++];
    strings.push(
      String.fromCodePoint(...operations.slice(cursor, cursor + length)),
    );
    cursor += length;
  }
  while (cursor < operations.length) {
    const operation = operations[cursor++];
    const id = operations[cursor++];
    if (operation === 1) {
      const type = operations[cursor++];
      assert.equal(
        nodes.has(id),
        false,
        'frontend cannot receive duplicate node IDs',
      );
      if (type === 11) {
        cursor += 4;
        nodes.set(id, { name: 'root', parent: 0 });
      } else {
        const parent = operations[cursor++];
        cursor++;
        const name = strings[operations[cursor++]];
        cursor++;
        assert.ok(
          nodes.has(parent),
          'frontend receives parents before children',
        );
        nodes.set(id, { name, parent });
      }
    } else if (operation === 2) {
      for (let count = 0; count < id; count++) {
        const removed = operations[cursor++];
        assert.ok(
          nodes.delete(removed),
          'frontend removes only existing nodes',
        );
      }
    } else if (operation === 3) {
      const count = operations[cursor++];
      for (let index = 0; index < count; index++)
        assert.ok(nodes.has(operations[cursor++]));
    } else if (operation === 4 || operation === 7) {
      cursor++;
    } else if (operation === 5) {
      cursor += 2;
    } else {
      throw new Error(`Unsupported frontend operation ${operation}`);
    }
  }
}

class FrontendSocket {
  static current: FrontendSocket;
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor() {
    FrontendSocket.current = this;
  }

  send(data: string): void {
    const message = messageSchema.parse(JSON.parse(data));
    if (message.event === 'operations')
      applyOperations(z.array(z.number()).parse(message.payload));
    if (message.event === 'inspectedElement')
      inspectedText = inspectionSchema.parse(message.payload).value.props.data
        .text;
    if (message.event === 'profilingData') {
      const profile = z
        .object({
          dataForRoots: z.array(z.object({ commitData: z.array(z.unknown()) })),
        })
        .parse(message.payload);
      profilingCommits = profile.dataForRoots.reduce(
        (sum, root) => sum + root.commitData.length,
        0,
      );
    }
  }

  open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  request(event: string, payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ event, payload }) });
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  value: FrontendSocket,
  configurable: true,
});
process.env.DEV = 'true';
const { render, Static, Text } = await import('ink');
function retainedEntries(propertyName: string): number {
  gcAndSweep();
  const snapshot = Bun.generateHeapSnapshot();
  const queueIDs = new Set<number>();
  for (let index = 0; index < snapshot.edges.length; index += 4) {
    if (
      snapshot.edgeTypes[snapshot.edges[index + 2]] !== 'Internal' &&
      snapshot.edgeTypes[snapshot.edges[index + 2]] !== 'Index' &&
      snapshot.edgeNames[snapshot.edges[index + 3]] === propertyName
    ) {
      queueIDs.add(snapshot.edges[index + 1]);
    }
  }
  let count = 0;
  for (let index = 0; index < snapshot.edges.length; index += 4) {
    if (
      queueIDs.has(snapshot.edges[index]) &&
      snapshot.edgeTypes[snapshot.edges[index + 2]] === 'Index'
    )
      count++;
  }
  return count;
}

function CurrentMessage({ text }: { text: string }): React.ReactElement {
  return React.createElement(Text, null, text);
}
function CommittedMessage({ text }: { text: string }): React.ReactElement {
  return React.createElement(Text, null, text);
}
function transcript(index: number, consumed: boolean): React.ReactElement {
  const chunkProperties = {
    items: consumed ? [] : [`DEVTOOLS3434_${index}_END`],
    children: (text: string): React.ReactElement =>
      React.createElement(CommittedMessage, { key: text, text }),
  };
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Static<string>, { ...chunkProperties, key: index }),
    React.createElement(CurrentMessage, { text: `current ${index}` }),
  );
}
let expected = 0;
let newOutput = 0;
let previousOutput = 0;
const stdout = new Writable({
  write(chunk, _encoding, done): void {
    for (const match of chunk.toString().matchAll(/DEVTOOLS3434_(\d+)_END/g)) {
      if (Number(match[1]) === expected) newOutput++;
      else previousOutput++;
    }
    done();
  },
});
Object.assign(stdout, { columns: 100, rows: 40, isTTY: true });
const stdin = new PassThrough();
Object.assign(stdin, { isTTY: false, setRawMode: () => {} });
const view = render(transcript(0, false), {
  stdout,
  stdin,
  patchConsole: false,
  exitOnCtrlC: false,
  maxFps: 1000,
});
async function append(index: number): Promise<void> {
  expected = index;
  newOutput = 0;
  previousOutput = 0;
  view.rerender(transcript(index, false));
  await sleep(5);
  assert.equal(newOutput, 1, 'every new Static body reaches stdout once');
  assert.equal(previousOutput, 0, 'no committed body is replayed');
  view.rerender(transcript(index, true));
  await sleep(5);
}
async function inspectCurrent(index: number): Promise<void> {
  const entry = [...nodes].find(([, node]) => node.name === 'CurrentMessage');
  assert.ok(entry, 'frontend snapshot contains the live component');
  inspectedText = undefined;
  FrontendSocket.current.request('inspectElement', {
    id: entry[0],
    rendererID: 1,
    requestID: index,
    forceFullData: true,
    path: null,
  });
  await sleep(30);
  assert.equal(
    inspectedText,
    `current ${index}`,
    'frontend inspects current props',
  );
}

try {
  await sleep(20);
  view.rerender(transcript(0, true));
  await sleep(20);
  const hook = z
    .object({
      renderers: z.map(
        z.number(),
        z.object({ rendererPackageName: z.string(), version: z.string() }),
      ),
    })
    .parse(Reflect.get(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__'));
  assert.equal(
    hook.renderers.get(1)?.rendererPackageName,
    'ink',
    'React receives Ink host identity',
  );
  const startQueue = retainedEntries('pendingOperationsQueue');
  for (let index = 1; index <= 600; index++) await append(index);
  const dormantQueue = retainedEntries('pendingOperationsQueue');
  assert.equal(
    dormantQueue,
    0,
    `disconnected backend retained ${dormantQueue} batches, starting at ${startQueue}`,
  );
  FrontendSocket.current.open();
  await sleep(50);
  assert.ok(
    operationBatches <= 2,
    'late connection gets current snapshot rather than historical commits',
  );
  await inspectCurrent(600);
  const initialNodes = nodes.size;
  FrontendSocket.current.request('startProfiling', {
    recordChangeDescriptions: true,
    recordTimeline: false,
  });
  for (let index = 601; index <= 620; index++) await append(index);
  FrontendSocket.current.request('stopProfiling', null);
  FrontendSocket.current.request('getProfilingData', { rendererID: 1 });
  await sleep(30);
  assert.equal(
    profilingCommits,
    80,
    'connected profiling receives Static layout and body commits for every chunk',
  );
  assert.equal(
    nodes.size,
    initialNodes,
    'connected operations preserve the live frontend tree',
  );
  await inspectCurrent(620);
  FrontendSocket.current.request('startProfiling', {
    recordChangeDescriptions: true,
    recordTimeline: true,
  });
  await append(621);
  const timelineBeforeDisconnect = retainedEntries('componentMeasures');
  assert.ok(
    timelineBeforeDisconnect > 0,
    'real timeline profiling records connected work',
  );
  FrontendSocket.current.close();
  nodes.clear();
  for (let index = 622; index <= 1220; index++) await append(index);
  assert.equal(
    retainedEntries('componentMeasures'),
    timelineBeforeDisconnect,
    'disconnect stops timeline recording and releases fiber-stack ownership',
  );
  const disconnectedQueue = retainedEntries('pendingOperationsQueue');
  assert.equal(
    disconnectedQueue,
    0,
    'disconnected backend does not journal further commits',
  );
  await sleep(2100);
  operationBatches = 0;
  FrontendSocket.current.open();
  await sleep(50);
  assert.ok(operationBatches <= 2, 'reconnect receives a fresh snapshot');
  await inspectCurrent(1220);
  view.unmount();
  await sleep(40);
  assert.equal(nodes.size, 0, 'unmount removes all frontend nodes');
  console.log(
    JSON.stringify({
      startQueue,
      dormantQueue,
      disconnectedQueue,
      connectedNodes: initialNodes,
      appends: 1220,
      unmountedNodes: nodes.size,
    }),
  );
} finally {
  view.unmount();
  view.cleanup();
  stdin.destroy();
  stdout.destroy();
}
process.exit(0);
