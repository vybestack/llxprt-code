/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
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

function startServer(): Promise<{
  readonly server: Server;
  readonly requests: string[];
  readonly registrationIds: string[];
  readonly port: number;
}> {
  return new Promise((resolve, reject) => {
    const requests: string[] = [];
    const registrationIds: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      const registrationId = request.headers['jsp-registration-id'];
      registrationIds.push(
        Array.isArray(registrationId)
          ? registrationId.join(',')
          : (registrationId ?? ''),
      );
      request.resume();
      request.on('end', () => {
        response.writeHead(200);
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
      resolve({ server, requests, registrationIds, port: address.port });
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

  it('registers the initial snapshot and publishes through authenticated routes', async () => {
    const started = await startServer();
    servers.push(started.server);
    const publisher = new JspHttpPublisher(bootstrap(started.port));
    expect(await publisher.register(snapshot)).toBe(true);
    expect(await publisher.publish(snapshot)).toBe(true);
    expect(started.requests).toStrictEqual([
      '/jsp/1/register',
      '/jsp/1/publish',
    ]);
    expect(started.registrationIds).toStrictEqual([
      'registration-a',
      'registration-a',
    ]);
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
