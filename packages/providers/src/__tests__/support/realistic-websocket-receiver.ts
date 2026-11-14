/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

const server = new WebSocketServer({ port: 0, maxPayload: 128 * 1024 * 1024 });
await once(server, 'listening');
const address = server.address();
if (typeof address !== 'object' || address === null)
  throw new Error('Missing receiver address');
process.stdout.write(
  `${JSON.stringify({ url: `http://127.0.0.1:${address.port}/responses` })}\n`,
);
server.on('connection', (socket) => {
  socket.on('message', (data, binary) => {
    function buffersOf(): readonly Buffer[] {
      if (Buffer.isBuffer(data)) return [data];
      if (data instanceof ArrayBuffer) return [Buffer.from(data)];
      return data;
    }
    const buffers = buffersOf();
    const hash = createHash('sha256');
    let bytes = 0;
    for (const buffer of buffers) {
      for (let offset = 0; offset < buffer.byteLength; offset += 65536) {
        const piece = buffer.subarray(offset, offset + 65536);
        hash.update(piece);
        bytes += piece.byteLength;
      }
    }
    const envelope: unknown =
      bytes < 65536
        ? JSON.parse(Buffer.concat(buffers).toString('utf8'))
        : undefined;
    process.stdout.write(
      `${JSON.stringify({ bytes, sha256: hash.digest('hex'), binary, envelope })}\n`,
    );
    socket.send(
      JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'realistic-response',
          status: 'completed',
          output: [],
          usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
        },
      }),
    );
  });
});
