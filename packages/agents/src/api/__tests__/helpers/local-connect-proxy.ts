/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';

export async function startLocalConnectProxy(): Promise<{
  readonly url: string;
  readonly readConnections: () => number;
  readonly close: () => Promise<void>;
}> {
  let connections = 0;
  const server = createServer((_request, response) =>
    response.writeHead(405).end(),
  );
  server.on('connect', (request, socket, head) => {
    const destination = new URL(`http://${request.url}`);
    if (destination.hostname !== '127.0.0.1') {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    connections++;
    const upstream = connect(Number(destination.port), destination.hostname);
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.end());
    upstream.on('close', () => socket.end());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing proxy address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    readConnections: () => connections,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
