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

export class JspHttpPublisher implements JspPublisher {
  private readonly baseEndpoint: string;
  private readonly authHeader: string;
  private readonly registrationId: string;

  constructor(bootstrap: JspBootstrap) {
    const endpoint = bootstrap.endpoint.replace(/\/$/, '');
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
    try {
      const response = await fetch(`${this.baseEndpoint}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: this.authHeader,
          'jsp-registration-id': this.registrationId,
        },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
