/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { localWireHashSink } from './local-wire-hash-sink.js';
import { WIRE_ROUTES } from './wireBodyCapture.js';

const route = WIRE_ROUTES.find((candidate) => candidate.id === process.argv[2]);
if (route === undefined || process.send === undefined)
  throw new Error('Hash sink worker requires a route and IPC');
let continueSample: (() => void) | undefined;
let chunks = 0;
const sink = await localWireHashSink(route, async (_bytes, receivedChunks) => {
  chunks = receivedChunks;
  const continued = new Promise<void>((resolve) => {
    continueSample = resolve;
  });
  process.send?.({ kind: 'sample' });
  await continued;
});
let reported = false;
const timer = setInterval(() => {
  if (!reported && sink.requests.length > 0) {
    reported = true;
    process.send?.({
      kind: 'body',
      ...sink.requests[0],
      chunks,
      entries: sink.entries(),
    });
  }
}, 10);
process.on('message', (message: unknown) => {
  if (message === 'continue') {
    continueSample?.();
    continueSample = undefined;
  } else if (message === 'close') {
    clearInterval(timer);
    void sink.close().then(() => process.disconnect());
  } else throw new Error('Unknown hash sink command');
});
process.send({ kind: 'ready', baseURL: sink.route.baseURL, pid: process.pid });
