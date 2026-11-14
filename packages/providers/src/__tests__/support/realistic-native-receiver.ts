/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { NativePayloadCounter } from './native-payload-counter.js';
import { WIRE_ROUTES } from './wireBodyCapture.js';

const [id, stateful, expected, port] = process.argv.slice(2);
const route = WIRE_ROUTES.find((entry) => entry.id === id);
if (route === undefined) throw new Error('Unknown receiver route');
const acknowledgements = createInterface({ input: process.stdin })[
  Symbol.asyncIterator
]();
async function checkpoint(phase: string): Promise<void> {
  process.stdout.write(`${JSON.stringify({ checkpoint: phase })}\n`);
  if ((await acknowledgements.next()).done === true)
    throw new Error('Sender closed');
}
const server = createServer((request, response) => {
  void (async (): Promise<void> => {
    const hash = createHash('sha256');
    const payload = new NativePayloadCounter(
      route.endpoint === '/responses' ? 'input' : 'messages',
    );
    let bytes = 0;
    let tail = '';
    let parentUsed = false;
    let nextQuarter = 1;
    await checkpoint('paused-upload');
    for await (const chunk of request) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Expected HTTP bytes');
      hash.update(chunk);
      payload.append(chunk);
      bytes += chunk.byteLength;
      const window = tail + chunk.toString('utf8');
      parentUsed ||= window.includes('"previous_response_id":"resp_parent"');
      tail = window.slice(-128);
      while (
        Number(expected) > 0 &&
        nextQuarter <= 3 &&
        bytes >= (Number(expected) * nextQuarter) / 4
      ) {
        const phase = ['quarter', 'half', 'three-quarter'][nextQuarter - 1];
        await checkpoint(phase);
        nextQuarter++;
      }
    }
    if (request.url?.endsWith(route.endpoint) !== true)
      throw new Error('Wrong endpoint');
    if (parentUsed !== (stateful === 'true'))
      throw new Error('Stateful parent mismatch');
    if (request.headers['content-length'] !== String(bytes))
      throw new Error('Content-Length mismatch');
    await checkpoint('body-admission');
    process.stdout.write(
      `${JSON.stringify({ bytes, sha256: hash.digest('hex'), selectedPayloadBytes: payload.byteLength() })}\n`,
    );
    const reply = route.respond();
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(await reply.text());
  })().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    response.destroy(error instanceof Error ? error : new Error(String(error)));
  });
});
server.listen(Number(port), '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing HTTP address');
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});
