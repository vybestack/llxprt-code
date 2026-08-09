/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import {
  closeServer,
  proxyRequest,
  stopEmbeddedMonitor,
  waitFor,
} from './ocr-concurrency-canary-2673-helpers.ts';
import type {
  MonitorResource,
  ProxyRequestOptions,
  ProxyResponse,
} from './ocr-concurrency-canary-2673-helpers.ts';

export type OcrScenarioServer = http.Server<
  typeof http.IncomingMessage,
  typeof http.ServerResponse
>;

export interface OcrScenarioScope {
  registerUpstream(server: OcrScenarioServer): OcrScenarioServer;
  registerMonitor(resource: MonitorResource): MonitorResource;
  trackRequest(request: http.ClientRequest): http.ClientRequest;
  proxyRequest(
    proxyUrl: string | URL,
    options: ProxyRequestOptions,
  ): Promise<ProxyResponse>;
  stopMonitor(): Promise<Record<string, unknown>>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withOcrScenario<T>(
  scenario: (scope: OcrScenarioScope) => Promise<T>,
): Promise<T> {
  let upstream: OcrScenarioServer | undefined;
  let monitor: MonitorResource | undefined;
  const clientRequests: Set<http.ClientRequest> = new Set();
  const clientResponses: Set<http.IncomingMessage> = new Set();

  const trackResponse = (
    response: http.IncomingMessage,
  ): http.IncomingMessage => {
    if (!clientResponses.has(response)) {
      clientResponses.add(response);
      response.once('close', () => {
        clientResponses.delete(response);
      });
    }
    return response;
  };

  const trackRequest = (request: http.ClientRequest): http.ClientRequest => {
    clientRequests.add(request);
    request.prependOnceListener('response', trackResponse);
    request.once('close', () => {
      clientRequests.delete(request);
    });
    return request;
  };

  const scope: OcrScenarioScope = {
    registerUpstream(server) {
      upstream = server;
      return server;
    },
    registerMonitor(resource) {
      monitor = resource;
      return resource;
    },
    trackRequest,
    proxyRequest(proxyUrl, options) {
      const onRequest = options.onRequest;
      return proxyRequest(proxyUrl, {
        ...options,
        onRequest(createdRequest) {
          trackRequest(createdRequest);
          try {
            onRequest?.(createdRequest);
          } catch (error) {
            createdRequest.destroy();
            clientRequests.delete(createdRequest);
            throw error;
          }
        },
      });
    },
    async stopMonitor() {
      if (monitor === undefined) {
        throw new Error('no monitor registered with the scenario scope');
      }
      const target = monitor;
      try {
        return await stopEmbeddedMonitor(target);
      } finally {
        if (
          target.child.exitCode !== null ||
          target.child.signalCode !== null
        ) {
          monitor = undefined;
        }
      }
    },
  };

  let outcome:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: unknown;
      };
  try {
    const value = await scenario(scope);
    outcome = { ok: true, value };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const cleanupFailures: unknown[] = [];
  for (const request of Array.from(clientRequests)) {
    try {
      if (request.destroyed) {
        clientRequests.delete(request);
        continue;
      }
      request.destroy();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  for (const response of Array.from(clientResponses)) {
    try {
      if (response.complete || response.destroyed) {
        clientResponses.delete(response);
      } else {
        response.destroy();
      }
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (clientRequests.size > 0 || clientResponses.size > 0) {
    try {
      await waitFor(
        () => clientRequests.size === 0 && clientResponses.size === 0,
        3000,
      );
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (monitor !== undefined) {
    try {
      await stopEmbeddedMonitor(monitor);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (upstream !== undefined) {
    try {
      await closeServer(upstream);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  let cleanupError: unknown;
  if (cleanupFailures.length === 1) {
    cleanupError = cleanupFailures[0];
  } else if (cleanupFailures.length > 1) {
    cleanupError = new AggregateError(
      cleanupFailures,
      'OCR scenario cleanup failed',
    );
  }

  if (!outcome.ok) {
    if (cleanupError !== undefined) {
      const primary =
        outcome.error instanceof Error
          ? outcome.error
          : new Error(errorMessage(outcome.error));
      throw new AggregateError(
        [primary, cleanupError],
        `OCR scenario failed: ${errorMessage(outcome.error)}; cleanup also failed: ${errorMessage(cleanupError)}`,
      );
    }
    throw outcome.error;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  return outcome.value;
}
