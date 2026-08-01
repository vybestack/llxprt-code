/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  JspBoundDocument,
  JspHeartbeatDocument,
  JspSnapshotDocument,
} from './jspDocuments.js';
import type { JspBootstrap } from './jspSchema.js';

export interface JspPublisher {
  register(snapshot: JspSnapshotDocument): Promise<boolean>;
  publish(document: JspBoundDocument): Promise<boolean>;
  heartbeat(document: JspHeartbeatDocument): Promise<boolean>;
}

/** Bound each publish so a stalled broker cannot wedge the queue. */
const REQUEST_TIMEOUT_MS = 5_000;

export class JspHttpPublisher implements JspPublisher {
  private readonly baseEndpoint: string;
  private readonly authHeader: string;
  private readonly registrationId: string;

  constructor(bootstrap: JspBootstrap) {
    // Trim trailing slashes without a backtracking-prone pattern.
    let endpoint = bootstrap.endpoint;
    while (endpoint.endsWith('/')) {
      endpoint = endpoint.slice(0, -1);
    }
    this.baseEndpoint = endpoint.endsWith('/jsp/1')
      ? endpoint
      : `${endpoint}/jsp/1`;
    this.authHeader = `Bearer ${bootstrap.publisherCredential}`;
    this.registrationId = bootstrap.registrationId;
  }

  register(snapshot: JspSnapshotDocument): Promise<boolean> {
    return this.post('/register', snapshot);
  }

  publish(document: JspBoundDocument): Promise<boolean> {
    return this.post('/publish', document);
  }

  heartbeat(document: JspHeartbeatDocument): Promise<boolean> {
    return this.post('/heartbeat', document);
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    // A broker that accepts the connection but never responds would otherwise
    // hang this request forever. The queue drains sequentially, so one hung
    // request stalls every later document and blocks shutdown. Bound it.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseEndpoint}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: this.authHeader,
          'jsp-registration-id': this.registrationId,
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      // Leaving the body unread can hold the connection open in undici, so
      // drain it before reporting the result.
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
