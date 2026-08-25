/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  cleanEmbeddedMonitors,
  closeServer,
  listen,
  startEmbeddedMonitor,
  waitFor,
} from './ocr-concurrency-canary-2673-helpers.ts';
import type { MonitorResource } from './ocr-concurrency-canary-2673-helpers.ts';
import { withOcrScenario } from './ocr-transport-lifecycle-2744-helpers.ts';
import type { OcrScenarioServer } from './ocr-transport-lifecycle-2744-helpers.ts';
import { asRecord, asString } from './typed-test-helpers.ts';

interface SpawnedMonitorHandle {
  child: {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal: string) => void;
  };
  directory: string;
}

function requireCaptured<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} was not captured`);
  }
  return value;
}

function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function responseCallbackFailureProbe(): Record<string, unknown> {
  const lifecycleHelperUrl = pathToFileURL(
    path.resolve('scripts/tests/ocr-transport-lifecycle-2744-helpers.ts'),
  ).href;
  const canaryHelperUrl = pathToFileURL(
    path.resolve('scripts/tests/ocr-concurrency-canary-2673-helpers.ts'),
  ).href;
  const source = `
    import http from 'node:http';
    import { closeServer, listen } from ${JSON.stringify(canaryHelperUrl)};
    import { withOcrScenario } from ${JSON.stringify(lifecycleHelperUrl)};

    const sentinel = new Error('sentinel response callback failure 2744');
    let callbackReject = () => {};
    const callbackFailure = new Promise((_, reject) => {
      callbackReject = reject;
    });
    let capturedResponse;
    let responseClosed = false;
    process.once('uncaughtException', (error) => callbackReject(error));

    const upstream = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: open\\n\\n');
    });
    const upstreamPort = await listen(upstream);
    let result;
    try {
      const caught = await withOcrScenario(async (scope) => {
        const request = http.request(
          'http://127.0.0.1:' + upstreamPort,
          (response) => {
            capturedResponse = response;
            response.once('close', () => {
              responseClosed = true;
            });
            throw sentinel;
          },
        );
        scope.trackRequest(request);
        request.end();
        await callbackFailure;
      }).then(
        () => undefined,
        (error) => error,
      );
      result = {
        exactPrimary: caught === sentinel,
        responseClosed,
        responseDestroyed: capturedResponse?.destroyed === true,
      };
    } finally {
      await closeServer(upstream);
    }
    process.stdout.write(JSON.stringify(result));
  `;
  return asRecord(
    JSON.parse(
      execFileSync(process.execPath, ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
        killSignal: 'SIGKILL',
      }),
    ),
  );
}

afterEach(cleanEmbeddedMonitors);

// These spawn the monitor and command-runner scripts embedded in ocr-review.yml, which runs on ubuntu-latest only and relies on POSIX SIGTERM for graceful shutdown. On Windows kill() terminates abruptly, so the child never flushes telemetry.json (ENOENT). The workflow-structure assertions in this file still run everywhere.
const IS_WINDOWS = process.platform === 'win32';

describe.skipIf(IS_WINDOWS)('OCR transport lifecycle — issue #2744', () => {
  it('aborts only after streamed data and observes request and response closure', async () => {
    const result = await withOcrScenario(async (scope) => {
      let requestBodyCompleted = false;
      const upstream = http.createServer((request, response) => {
        request.resume();
        request.once('end', () => {
          requestBodyCompleted = true;
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write('data: first\n\n');
        });
      });
      scope.registerUpstream(upstream);
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );
      scope.registerMonitor(resource);

      let firstChunkObserved = false;
      let requestClosed = false;
      let responseClosed = false;
      const clientRequest = http.request(
        new URL(asString(resource.ready.proxy_url)),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-stainless-retry-count': '0',
          },
        },
        (response) => {
          response.once('close', () => {
            responseClosed = true;
          });
          response.on('data', () => {
            if (!firstChunkObserved) {
              firstChunkObserved = true;
              clientRequest.destroy();
            }
          });
        },
      );
      scope.trackRequest(clientRequest);
      clientRequest.once('close', () => {
        requestClosed = true;
      });
      clientRequest.end('{"test":true}');

      await waitFor(() => firstChunkObserved, 3000);
      await waitFor(() => requestClosed && responseClosed, 3000);
      const telemetry = await scope.stopMonitor();
      return {
        telemetry,
        firstChunkObserved,
        requestBodyCompleted,
        requestClosed,
        requestDestroyed: clientRequest.destroyed,
        responseClosed,
      };
    });

    expect(result.firstChunkObserved).toBe(true);
    expect(result.requestBodyCompleted).toBe(true);
    expect(result.requestClosed).toBe(true);
    expect(result.requestDestroyed).toBe(true);
    expect(result.responseClosed).toBe(true);
    expect(result.telemetry.total_requests).toBe(1);
    expect(result.telemetry.upstream_errors).toBe(0);
    expect(result.telemetry.responses_by_status).toEqual({ 200: 1 });
  });

  it('owns a direct response before its callback can fail', () => {
    const result = responseCallbackFailureProbe();

    expect(result.exactPrimary).toBe(true);
    expect(result.responseDestroyed).toBe(true);
    expect(result.responseClosed).toBe(true);
  });

  it('fails and reaps the monitor child for an invalid target', async () => {
    let spawned: SpawnedMonitorHandle | undefined;
    const caught = await captureError(
      startEmbeddedMonitor('file:///tmp/not-http', {
        onSpawn: (resource) => {
          spawned = resource;
        },
      }),
    );

    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error('invalid-target failure was not an Error');
    }
    expect(caught.message).toMatch(/monitor failed to start/i);
    expect(caught.cause).toBeInstanceOf(Error);
    if (!(caught.cause instanceof Error)) {
      throw new Error('invalid-target failure did not retain its cause');
    }
    expect(caught.cause.message).toMatch(/exited before publishing readiness/i);
    const monitor = requireCaptured(spawned, 'spawned monitor');
    expect(monitor.child.exitCode ?? monitor.child.signalCode).not.toBeNull();
    expect(fs.existsSync(monitor.directory)).toBe(false);
  });

  it('fails and reaps the monitor child for a readiness timeout after spawn', async () => {
    let spawned: SpawnedMonitorHandle | undefined;
    const caught = await captureError(
      startEmbeddedMonitor('https://provider.invalid/v1', {
        startupTimeoutMs: 100,
        monitorReadyFileName: 'unobserved-ready.json',
        onSpawn: (resource) => {
          spawned = resource;
        },
      }),
    );

    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error('readiness-timeout failure was not an Error');
    }
    expect(caught.message).toMatch(/monitor failed to start.*timed out/i);
    expect(caught.cause).toBeInstanceOf(Error);
    if (!(caught.cause instanceof Error)) {
      throw new Error('readiness-timeout failure did not retain its cause');
    }
    expect(caught.cause.message).toMatch(/timed out/i);
    const monitor = requireCaptured(spawned, 'spawned monitor');
    expect(monitor.child.exitCode ?? monitor.child.signalCode).not.toBeNull();
    expect(fs.existsSync(monitor.directory)).toBe(false);
  });

  it('preserves exact startup failure identity while reaping partial initialization', async () => {
    const sentinel = new Error('sentinel monitor startup failure 2744');
    let spawned: SpawnedMonitorHandle | undefined;
    const caught = await captureError(
      startEmbeddedMonitor('https://provider.invalid/v1', {
        onSpawn: (resource) => {
          spawned = resource;
          throw sentinel;
        },
      }),
    );

    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error('partial-startup failure was not an Error');
    }
    expect(caught.cause).toBe(sentinel);
    const monitor = requireCaptured(spawned, 'spawned monitor');
    expect(monitor.child.exitCode ?? monitor.child.signalCode).not.toBeNull();
    expect(fs.existsSync(monitor.directory)).toBe(false);
  });

  it('releases every registered resource when a scenario throws after traffic', async () => {
    const sentinel = new Error('sentinel lifecycle failure 2744');
    let capturedServer: OcrScenarioServer | undefined;
    let capturedRequest: http.ClientRequest | undefined;
    let spawned: SpawnedMonitorHandle | undefined;
    let requestClosed = false;
    let upstreamReceivedBody = false;
    const upstreamSockets = new Set<Socket>();
    const caught = await captureError(
      withOcrScenario(async (scope) => {
        const upstream = http.createServer((request, response) => {
          request.on('data', () => {
            upstreamReceivedBody = true;
          });
          request.on('end', () => response.writeHead(200).end('ok'));
        });
        upstream.on('connection', (socket) => {
          upstreamSockets.add(socket);
          socket.once('close', () => upstreamSockets.delete(socket));
        });
        scope.registerUpstream(upstream);
        capturedServer = upstream;
        const upstreamPort = await listen(upstream);
        const resource = await startEmbeddedMonitor(
          `http://127.0.0.1:${upstreamPort}/v1`,
          {
            onSpawn: (monitor) => {
              spawned = monitor;
            },
          },
        );
        scope.registerMonitor(resource);
        const request = http.request(
          new URL(asString(resource.ready.proxy_url)),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-stainless-retry-count': '0',
            },
          },
        );
        scope.trackRequest(request);
        capturedRequest = request;
        request.once('close', () => {
          requestClosed = true;
        });
        request.write('{"test":true}');
        await waitFor(() => upstreamReceivedBody, 3000);
        throw sentinel;
      }),
    );

    const server = requireCaptured(capturedServer, 'upstream server');
    const request = requireCaptured(capturedRequest, 'client request');
    const monitor = requireCaptured(spawned, 'spawned monitor');
    expect(caught).toBe(sentinel);
    expect(server.listening).toBe(false);
    expect(upstreamSockets.size).toBe(0);
    expect(request.destroyed).toBe(true);
    expect(requestClosed).toBe(true);
    expect(monitor.child.exitCode ?? monitor.child.signalCode).not.toBeNull();
    expect(fs.existsSync(monitor.directory)).toBe(false);
  });

  it('retains a monitor for fallback cleanup when termination fails', async () => {
    const scenarioFailure = new Error('sentinel monitor scenario failure 2744');
    const stopFailure = new Error('sentinel monitor stop failure 2744');
    let resource: MonitorResource | undefined;
    let originalKill: ((signal: string) => void) | undefined;
    let caught: unknown;
    let childRunningBeforeFallback = false;
    let fallbackReapedChild = false;
    let fallbackRemovedDirectory = false;

    try {
      caught = await captureError(
        withOcrScenario(async (scope) => {
          const upstream = http.createServer((_request, response) => {
            response.writeHead(200).end('ok');
          });
          scope.registerUpstream(upstream);
          const upstreamPort = await listen(upstream);
          const monitor = await startEmbeddedMonitor(
            `http://127.0.0.1:${upstreamPort}/v1`,
          );
          resource = monitor;
          scope.registerMonitor(monitor);
          originalKill = monitor.child.kill.bind(monitor.child);
          let shouldFail = true;
          monitor.child.kill = (signal) => {
            if (shouldFail) {
              shouldFail = false;
              throw stopFailure;
            }
            originalKill?.(signal);
          };
          throw scenarioFailure;
        }),
      );

      const monitor = requireCaptured(resource, 'monitor resource');
      childRunningBeforeFallback =
        monitor.child.exitCode === null && monitor.child.signalCode === null;
      monitor.child.kill = requireCaptured(originalKill, 'original child kill');
      await cleanEmbeddedMonitors();
      fallbackReapedChild =
        monitor.child.exitCode !== null || monitor.child.signalCode !== null;
      fallbackRemovedDirectory = !fs.existsSync(monitor.directory);
    } finally {
      if (resource !== undefined && originalKill !== undefined) {
        const monitor = resource;
        monitor.child.kill = originalKill;
        if (
          monitor.child.exitCode === null &&
          monitor.child.signalCode === null
        ) {
          originalKill('SIGKILL');
          await waitFor(
            () =>
              monitor.child.exitCode !== null ||
              monitor.child.signalCode !== null,
          );
        }
        fs.rmSync(monitor.directory, { recursive: true, force: true });
      }
    }

    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) {
      throw new Error('scenario and monitor stop failures were not aggregated');
    }
    expect(caught.errors[0]).toBe(scenarioFailure);
    expect(caught.errors[1]).toBe(stopFailure);
    expect(childRunningBeforeFallback).toBe(true);
    expect(fallbackReapedChild).toBe(true);
    expect(fallbackRemovedDirectory).toBe(true);
  });

  it('preserves a throwing request callback without a cleanup timeout', async () => {
    const sentinel = new Error('sentinel request callback failure 2744');
    let capturedRequest: http.ClientRequest | undefined;
    const caught = await captureError(
      withOcrScenario(async (scope) => {
        await scope.proxyRequest('http://127.0.0.1:1', {
          authorization: 'Bearer callback',
          body: '{"request":"callback"}',
          retryCount: '0',
          onRequest: (request) => {
            capturedRequest = request;
            throw sentinel;
          },
        });
      }),
    );

    const request = requireCaptured(capturedRequest, 'callback request');
    expect(caught).toBe(sentinel);
    expect(request.destroyed).toBe(true);
  });

  it('closes an internal sibling request and keeps cleanup failure secondary', async () => {
    const cleanupFailure = new Error('sentinel upstream cleanup failure 2744');
    const upstreamSockets = new Set<Socket>();
    let openRequestSeen = false;
    let openRequestClosed = false;
    let openClientResponseClosed = false;
    let capturedOpenRequest: http.ClientRequest | undefined;
    let scenarioFailure: unknown;
    const upstream = http.createServer((request, response) => {
      if (request.url === '/open') {
        openRequestSeen = true;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: open\n\n');
        return;
      }
      request.socket.destroy();
    });
    upstream.on('connection', (socket) => {
      upstreamSockets.add(socket);
      socket.once('close', () => upstreamSockets.delete(socket));
    });
    upstream.closeAllConnections = () => {
      throw cleanupFailure;
    };

    try {
      const caught = await captureError(
        withOcrScenario(async (scope) => {
          scope.registerUpstream(upstream);
          const upstreamPort = await listen(upstream);
          const target = `http://127.0.0.1:${upstreamPort}`;
          const openRequest = scope
            .proxyRequest(target, {
              authorization: 'Bearer open',
              body: '{"request":"open"}',
              pathSuffix: '/open',
              retryCount: '0',
              onRequest: (request) => {
                capturedOpenRequest = request;
                request.once('close', () => {
                  openRequestClosed = true;
                });
                request.once('response', (response) => {
                  response.once('close', () => {
                    openClientResponseClosed = true;
                  });
                });
              },
            })
            .catch(() => undefined);
          await waitFor(() => openRequestSeen, 3000);
          try {
            await scope.proxyRequest(target, {
              authorization: 'Bearer fail',
              body: '{"request":"fail"}',
              pathSuffix: '/fail',
              retryCount: '0',
            });
          } catch (error) {
            scenarioFailure = error;
            throw error;
          }
          await openRequest;
        }),
      );

      expect(caught).toBeInstanceOf(AggregateError);
      if (!(caught instanceof AggregateError)) {
        throw new Error('combined failure was not an AggregateError');
      }
      expect(caught.errors[0]).toBe(scenarioFailure);
      expect(caught.errors[1]).toBe(cleanupFailure);
      const openRequest = requireCaptured(
        capturedOpenRequest,
        'internally created open request',
      );
      expect(openRequest.destroyed).toBe(true);
      expect(openRequestClosed).toBe(true);
      expect(openClientResponseClosed).toBe(true);
    } finally {
      upstream.closeAllConnections = () => {
        for (const socket of upstreamSockets) {
          socket.destroy();
        }
      };
      await closeServer(upstream);
    }
  });
});
