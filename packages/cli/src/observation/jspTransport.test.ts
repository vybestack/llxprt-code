/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'bun:test';
import type { JspBoundDocument, JspSnapshotDocument } from './jspDocuments.js';
import { JspHttpPublisher } from './jspPublisher.js';
import { JspBoundedQueue, type JspQueueSink } from './jspQueue.js';
import type { JspBootstrap } from './jspSchema.js';

const snapshot: JspSnapshotDocument = {
  schema: 1,
  kind: 'snapshot',
  agent_id: 'agent-a',
  lifecycle_generation: 1,
  source_epoch: 'epoch-a',
  source_sequence: 0,
  cursor: 0,
  bridge_observed_ms: 1,
  native_session: {
    repository: 'repo',
    path: '/repo',
    agent_kind: 'llxprt',
    pid: 1,
    display_name: 'worker',
  },
  process_binding: {
    provenance: 'authoritative',
    availability: 'known',
    value: { pid: 1, started_at_ms: 1 },
  },
  native_activity: {
    provenance: 'authoritative',
    availability: 'known',
    value: { state: 'idle' },
  },
  current_wait: {
    provenance: 'authoritative',
    availability: 'known',
    value: null,
  },
  current_turn: {
    provenance: 'authoritative',
    availability: 'known',
    value: null,
  },
  todos: {
    provenance: 'authoritative',
    availability: 'known',
    value: { revision: 1, items: [] },
  },
  last_displayed_assistant_message: {
    provenance: 'inferred',
    availability: 'unknown',
  },
  last_created_tool_call: {
    provenance: 'authoritative',
    availability: 'unknown',
  },
  source_terminal_state: {
    provenance: 'authoritative',
    availability: 'known',
    value: null,
  },
  source_error_state: {
    provenance: 'authoritative',
    availability: 'unknown',
  },
};

function bootstrap(port: number): JspBootstrap {
  return {
    schema: 1,
    protocol: 'jsp/1',
    endpoint: `http://127.0.0.1:${port}`,
    registrationId: 'registration-a',
    publisherCredential: 'credential-a',
    agentId: 'agent-a',
    lifecycleGeneration: 1,
  };
}

function headerValue(value: string | string[] | undefined): string {
  if (value === undefined) {
    return '';
  }
  return Array.isArray(value) ? value.join(',') : value;
}

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly contentType: string;
  readonly registrationId: string;
  readonly authorization: string;
  readonly body: string;
}

interface ServerHandle {
  readonly server: Server;
  readonly requests: CapturedRequest[];
  readonly port: number;
  setStatus(status: number): void;
}

function startServer(): Promise<ServerHandle> {
  const requests: CapturedRequest[] = [];
  let status = 200;
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const headers = request.headers;
        requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          contentType: headerValue(headers['content-type']),
          registrationId: headerValue(headers['jsp-registration-id']),
          authorization: headerValue(headers['authorization']),
          body,
        });
        response.writeHead(status);
        response.end();
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('loopback server did not bind a TCP port'));
        return;
      }
      resolve({
        server,
        requests,
        port: address.port,
        setStatus: (s: number) => {
          status = s;
        },
      });
    });
  });
}

describe('JSP transport', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('registers the initial snapshot and publishes through authenticated POST routes', async () => {
    const started = await startServer();
    servers.push(started.server);
    const publisher = new JspHttpPublisher(bootstrap(started.port));
    expect(await publisher.register(snapshot)).toStrictEqual({ kind: 'ok' });
    expect(await publisher.publish(snapshot)).toStrictEqual({ kind: 'ok' });
    expect(started.requests.map((r) => r.url)).toStrictEqual([
      '/jsp/1/register',
      '/jsp/1/publish',
    ]);
    // Every request must be POST with JSON content-type and auth header.
    for (const req of started.requests) {
      expect(req.method).toBe('POST');
      expect(req.contentType).toBe('application/json');
      expect(req.authorization).toBe('Bearer credential-a');
      expect(req.registrationId).toBe('registration-a');
    }
    // Validate the JSON body shape of the registration document.
    const registerBody = JSON.parse(started.requests[0].body) as Record<
      string,
      unknown
    >;
    expect(registerBody['kind']).toBe('snapshot');
    expect(registerBody['schema']).toBe(1);
    expect(registerBody['agent_id']).toBe('agent-a');
    expect(registerBody['native_session']).toMatchObject({
      repository: 'repo',
      agent_kind: 'llxprt',
    });
  });

  it('reports rejection instead of throwing when the broker answers non-2xx', async () => {
    const started = await startServer();
    servers.push(started.server);
    started.setStatus(409);
    const publisher = new JspHttpPublisher(bootstrap(started.port));
    const result = await publisher.register(snapshot);
    expect(result).toStrictEqual({ kind: 'rejected', status: 409 });
  });

  it('reports transport failure when the broker is unreachable', async () => {
    // Point at a port that is guaranteed not to have a listener.
    const publisher = new JspHttpPublisher(bootstrap(1));
    const result = await publisher.register(snapshot);
    expect(result).toStrictEqual({ kind: 'transport' });
  });

  it('bounds synchronous enqueue and marks snapshot-first recovery on overflow', () => {
    const pending: JspBoundDocument[] = [];
    const sink: JspQueueSink = {
      send(document) {
        pending.push(document);
        return new Promise<boolean>(() => undefined);
      },
    };
    const queue = new JspBoundedQueue(sink, { capacity: 1 });
    expect(queue.enqueue(snapshot)).toBe(true);
    expect(queue.enqueue(snapshot)).toBe(false);
    expect(queue.overflowed).toBe(true);
    expect(queue.needsSnapshotRecovery()).toBe(true);
    expect(pending).toStrictEqual([]);
    queue.stop();
  });
});
