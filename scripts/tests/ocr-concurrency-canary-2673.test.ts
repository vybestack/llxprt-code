/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asOptionalRecord, asRecord, asString } from './typed-test-helpers.ts';
import type { WorkflowStep } from './typed-test-helpers.ts';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.ts';
import {
  evaluateOcrConcurrency,
  extractEmbeddedSource,
  waitFor,
  listen,
  closeServer,
  proxyRequest,
  withTempDirectory,
  loadWorkflow,
  startEmbeddedMonitor,
  stopEmbeddedMonitor,
  cleanEmbeddedMonitors,
} from './ocr-concurrency-canary-2673-helpers.ts';

afterEach(cleanEmbeddedMonitors);

describe('.github/workflows/ocr-review.yml — issue #2673 concurrency canary', () => {
  let workflow: Record<string, unknown>;
  let codeReviewJob: Record<string, unknown> | undefined;
  let dispatchInputs: Record<string, unknown> | undefined;

  beforeAll(() => {
    const loaded = loadWorkflow();
    workflow = asRecord(loaded.parsed);
    const jobs = asOptionalRecord(workflow['jobs']);
    codeReviewJob = asRecord(jobs?.['code-review'] ?? undefined);
    const on = asOptionalRecord(workflow['on']);
    const dispatch = asOptionalRecord(on?.['workflow_dispatch']);
    dispatchInputs = asRecord(dispatch?.['inputs'] ?? undefined);
  });

  describe('manual concurrency selection', () => {
    it('limits the required dispatch choice to 2, 3, and 4 with default 3', () => {
      expect(dispatchInputs?.concurrency).toMatchObject({
        type: 'choice',
        required: true,
        default: '3',
        options: ['2', '3', '4'],
      });
    });

    it('keeps automatic/comment runs at 3 and resolves dispatch selections', () => {
      const expression = asString(
        asOptionalRecord(workflow.env)?.['OCR_CONCURRENCY'],
      );
      expect(
        evaluateOcrConcurrency(expression, {
          eventName: 'pull_request_target',
        }),
      ).toBe('3');
      expect(
        evaluateOcrConcurrency(expression, { eventName: 'issue_comment' }),
      ).toBe('3');
      expect(
        evaluateOcrConcurrency(expression, {
          eventName: 'workflow_dispatch',
          concurrency: '4',
        }),
      ).toBe('4');
    });

    it('does not alter the review pin, model, range, timeout, audience, or format', () => {
      const reviewStep = stepNamed(
        asRecord(codeReviewJob),
        'Run OpenCodeReview',
      );
      const reviewRun = commandText(reviewStep);
      expect(asOptionalRecord(workflow.env)?.['OCR_VERSION']).toBe('1.8.4');
      expect(asOptionalRecord(reviewStep.env)?.['OCR_LLM_MODEL']).toBe(
        '${{ vars.OCR_LLM_MODEL }}',
      );
      expect(asOptionalRecord(reviewStep.env)?.['FROM_SHA']).toBe(
        "${{ github.event_name == 'workflow_dispatch' && env.MERGE_BASE_SHA || steps.resolve-range.outputs.FROM_SHA }}",
      );
      expect(reviewRun).toContain('--from "$FROM_SHA"');
      expect(reviewRun).toContain('--to "$HEAD_SHA"');
      expect(reviewRun).toContain('--timeout "$REVIEW_TIMEOUT"');
      expect(reviewRun).toContain('--concurrency "$OCR_CONCURRENCY"');
      expect(reviewRun).toContain('--audience agent');
      expect(reviewRun).toContain('--format json');
    });
  });

  describe('dispatch-only loopback transport monitor', () => {
    it('is trusted inline workflow code around only the real review call', () => {
      const start = stepNamed(
        asRecord(codeReviewJob),
        'Start OCR transport monitor',
      );
      const stop = stepNamed(
        asRecord(codeReviewJob),
        'Stop OCR transport monitor',
      );
      const review = stepNamed(asRecord(codeReviewJob), 'Run OpenCodeReview');
      const stepsRaw = asRecord(codeReviewJob)['steps'];
      const steps: WorkflowStep[] = [];
      if (Array.isArray(stepsRaw)) {
        for (const s of stepsRaw) {
          if (s !== null && typeof s === 'object' && !Array.isArray(s)) {
            steps.push(asRecord(s));
          }
        }
      }
      expect(String(start.if)).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      expect(String(stop.if)).toContain('always()');
      expect(String(stop.if)).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      const startIdx = steps.findIndex((s) => s === start);
      const reviewIdx = steps.findIndex((s) => s === review);
      const stopIdx = steps.findIndex((s) => s === stop);
      expect(startIdx).toBeLessThan(reviewIdx);
      expect(stopIdx).toBe(reviewIdx + 1);
      expect(commandText(start)).toContain("server.listen(0, '127.0.0.1'");
      expect(commandText(start)).toContain('for _ in $(seq 1 300); do');
      expect(commandText(start)).not.toMatch(/checkout|pr-head|HEAD_SHA/);
    });

    it('proves the fresh OCR config cannot override the environment endpoint', () => {
      const configure = stepNamed(
        asRecord(codeReviewJob),
        'Configure OCR LLM settings',
      );
      const run = commandText(configure);
      const source = extractEmbeddedSource(
        run,
        'ocr-config-endpoint-preflight.cjs',
        'PREFLIGHT',
      );
      return withTempDirectory(
        'ocr-config-preflight-2673-',
        (directory: string) => {
          const scriptPath = path.join(directory, 'preflight.cjs');
          const configPath = path.join(directory, 'config.json');
          fs.writeFileSync(scriptPath, source);
          fs.writeFileSync(
            configPath,
            JSON.stringify({ llm: { extra_body: '{}' }, language: 'English' }),
          );

          expect(() =>
            execFileSync(process.execPath, [scriptPath], {
              env: {
                ...process.env,
                OCR_CONFIG_PATH: configPath,
                OCR_LLM_URL: 'https://environment-provider.invalid/v1',
              },
            }),
          ).not.toThrow();
          fs.writeFileSync(
            configPath,
            JSON.stringify({
              llm: {
                provider: 'custom',
                url: 'https://configuration-provider.invalid/v1',
              },
            }),
          );
          expect(() =>
            execFileSync(process.execPath, [scriptPath], {
              env: {
                ...process.env,
                OCR_CONFIG_PATH: configPath,
                OCR_LLM_URL: 'https://environment-provider.invalid/v1',
              },
              stdio: 'pipe',
            }),
          ).toThrow();
          expect(asOptionalRecord(configure.env)?.['OCR_LLM_URL']).toBe(
            '${{ vars.OCR_LLM_URL }}',
          );
          expect(run).toContain('ocr-configured-settings.json');
          expect(run).not.toContain('ocr-applied-llm-config.json');
        },
      );
    });

    it('keeps automatic/comment reviews direct and rewrites only dispatch review traffic', () => {
      const review = stepNamed(asRecord(codeReviewJob), 'Run OpenCodeReview');
      const expression = String(asOptionalRecord(review.env)?.['OCR_LLM_URL']);
      expect(expression).toContain("github.event_name == 'workflow_dispatch'");
      expect(expression).toContain(
        'steps.ocr-transport-monitor.outputs.proxy_url',
      );
      expect(expression).toContain('vars.OCR_LLM_URL');
      for (const stepName of [
        'Validate OCR configuration',
        'Validate OCR LLM connectivity',
        'Verify review scope includes changed tests',
      ]) {
        expect(
          asOptionalRecord(stepNamed(asRecord(codeReviewJob), stepName).env)?.[
            'OCR_LLM_URL'
          ],
        ).toBe('${{ vars.OCR_LLM_URL }}');
      }
    });

    it('uses canonical retry headers 0 and 1 while preserving streaming and stripping connection-nominated headers', async () => {
      const received: Array<Record<string, unknown>> = [];
      const upstream = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            requestHop: request.headers['x-request-hop'],
            body: Buffer.concat(chunks).toString('utf8'),
          });
          response.writeHead(received.length === 1 ? 429 : 200, {
            connection: 'x-response-hop',
            'content-type': 'application/json',
            'x-response-hop': 'must-not-forward',
            'x-upstream-test': 'preserved',
          });
          response.write(received.length === 1 ? '{"retry":' : '{"ok":');
          response.end('true}');
        });
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1?mode=test`,
      );
      const secret = 'Bearer transport-secret-2673';
      const body = '{"prompt":"sensitive prompt 2673"}';
      const common = {
        body,
        authorization: secret,
        headers: {
          connection: 'x-request-hop',
          'x-request-hop': 'must-not-forward',
        },
      };

      const first = await proxyRequest(asString(resource.ready.proxy_url), {
        ...common,
        retryCount: '0',
      });
      const second = await proxyRequest(asString(resource.ready.proxy_url), {
        ...common,
        retryCount: '1',
      });
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect([first.statusCode, second.statusCode]).toEqual([429, 200]);
      expect(second.body).toBe('{"ok":true}');
      expect(second.headers['x-upstream-test']).toBe('preserved');
      expect(second.headers['x-response-hop']).toBeUndefined();
      expect(received).toEqual([
        {
          method: 'POST',
          url: '/v1?mode=test',
          authorization: secret,
          requestHop: undefined,
          body,
        },
        {
          method: 'POST',
          url: '/v1?mode=test',
          authorization: secret,
          requestHop: undefined,
          body,
        },
      ]);
      expect(telemetry).toMatchObject({
        total_requests: 2,
        http_429_responses: 1,
        retry_events: 1,
        retry_count_header_missing: 0,
        retry_count_header_malformed: 0,
        responses_by_status: { 200: 1, 429: 1 },
        shutdown_complete: true,
      });
      const persisted = JSON.stringify(telemetry);
      expect(persisted).not.toContain(secret);
      expect(persisted).not.toContain(body);
      expect(persisted).not.toContain('x-stainless-retry-count');
      expect(persisted).not.toMatch(/fingerprint|retry_delay/i);
    });

    it('counts every SDK retry request and every actual 429 response', async () => {
      let requestCount = 0;
      const upstream = http.createServer((request, response) => {
        request.resume();
        request.on('end', () => {
          requestCount += 1;
          response.writeHead(requestCount <= 3 ? 429 : 200).end('done');
        });
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );

      for (const retryCount of ['0', '1', '2', '3']) {
        await proxyRequest(asString(resource.ready.proxy_url), {
          body: '{}',
          authorization: 'Bearer repeated-429-token',
          retryCount,
        });
      }
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(telemetry.retry_events).toBe(3);
      expect(telemetry.http_429_responses).toBe(3);
      expect(telemetry.responses_by_status).toEqual({ 200: 1, 429: 3 });
    });

    it('counts a connection-error retry when the next SDK request reports retry count 1', async () => {
      let requestCount = 0;
      const upstream = http.createServer((request, response) => {
        requestCount += 1;
        if (requestCount === 1) {
          request.socket.destroy();
          return;
        }
        request.resume();
        request.on('end', () => response.writeHead(200).end('ok'));
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );

      const first = await proxyRequest(asString(resource.ready.proxy_url), {
        body: '{}',
        authorization: 'Bearer network-retry-token',
        retryCount: '0',
      });
      const second = await proxyRequest(asString(resource.ready.proxy_url), {
        body: '{}',
        authorization: 'Bearer network-retry-token',
        retryCount: '1',
      });
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect([first.statusCode, second.statusCode]).toEqual([502, 200]);
      expect(telemetry).toMatchObject({
        total_requests: 2,
        upstream_errors: 1,
        retry_events: 1,
        responses_by_status: { 200: 1 },
      });
    });

    it('does not infer retries from concurrent or later identical header-0 requests', async () => {
      const pending: http.ServerResponse[] = [];
      let requestCount = 0;
      const upstream = http.createServer((request, response) => {
        request.resume();
        request.on('end', () => {
          requestCount += 1;
          if (requestCount <= 2) {
            pending.push(response);
            if (pending.length === 2) {
              pending[0].writeHead(429).end('retry');
              pending[1].writeHead(200).end('ok');
            }
          } else {
            response.writeHead(200).end('ok');
          }
        });
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );
      const request = {
        body: '{"same":"body"}',
        authorization: 'Bearer same-token',
        retryCount: '0',
      };

      await Promise.all([
        proxyRequest(asString(resource.ready.proxy_url), request),
        proxyRequest(asString(resource.ready.proxy_url), request),
      ]);
      await proxyRequest(asString(resource.ready.proxy_url), request);
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(telemetry.http_429_responses).toBe(1);
      expect(telemetry.retry_events).toBe(0);
      expect(telemetry.total_requests).toBe(3);
    });

    it('records only aggregate malformed and missing retry-header counts', async () => {
      const upstream = http.createServer((request, response) => {
        request.resume();
        request.on('end', () => response.writeHead(200).end('ok'));
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );

      await proxyRequest(asString(resource.ready.proxy_url), {
        body: '{}',
        authorization: 'Bearer malformed-token',
        retryCount: null,
      });
      await proxyRequest(asString(resource.ready.proxy_url), {
        body: '{}',
        authorization: 'Bearer malformed-token',
        retryCount: '01',
      });
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(telemetry).toMatchObject({
        total_requests: 2,
        retry_events: 0,
        retry_count_header_missing: 1,
        retry_count_header_malformed: 1,
      });
      expect(JSON.stringify(telemetry)).not.toContain('01');
    });

    it('streams delayed SSE responses and forwards chunked request bodies without buffering', async () => {
      let upstreamCompleted = false;
      let receivedBody = '';
      const upstream = http.createServer((request, response) => {
        request.on('data', (chunk) => {
          receivedBody += chunk;
        });
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write('data: first\n\n');
          setTimeout(() => {
            upstreamCompleted = true;
            response.end('data: second\n\n');
          }, 150);
        });
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );
      const url = new URL(asString(resource.ready.proxy_url));
      let firstChunkBeforeCompletion = false;

      const responseBody = await new Promise<string>((resolve, reject) => {
        const request = http.request(
          url,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-stainless-retry-count': '0',
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => {
              if (chunks.length === 0) {
                firstChunkBeforeCompletion = !upstreamCompleted;
              }
              chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks).toString()));
          },
        );
        request.once('error', reject);
        request.write('{"chunk":');
        setTimeout(() => request.end('true}'), 25);
      });
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(receivedBody).toBe('{"chunk":true}');
      expect(responseBody).toBe('data: first\n\ndata: second\n\n');
      expect(firstChunkBeforeCompletion).toBe(true);
      expect(telemetry.responses_by_status).toEqual({ 200: 1 });
    });

    it('handles an upstream error after headers and partial body without crashing or double-counting', async () => {
      const upstream = http.createServer((request, response) => {
        request.resume();
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.write('{"partial":');
          setImmediate(() =>
            response.destroy(new Error('upstream mid-stream crash')),
          );
        });
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );

      const result = await new Promise<{
        statusCode: number | undefined;
        body: string;
      }>((resolve) => {
        const proxyRequest = http.request(
          new URL(asString(resource.ready.proxy_url)),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-stainless-retry-count': '0',
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                statusCode: response.statusCode,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
            response.on('error', () =>
              resolve({
                statusCode: response.statusCode,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        proxyRequest.once('error', () =>
          resolve({ statusCode: 0, body: 'connection error' }),
        );
        proxyRequest.end('{"test":true}');
      });
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(telemetry.total_requests).toBe(1);
      expect(telemetry.upstream_errors).toBe(0);
      expect(telemetry.responses_by_status).toEqual({ 200: 1 });
      expect(result.statusCode).toBe(200);
    });

    it('handles a client-aborted request during streaming without crashing or double-counting', async () => {
      const upstream = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: first\n\n');
      });
      const upstreamPort = await listen(upstream);
      const resource = await startEmbeddedMonitor(
        `http://127.0.0.1:${upstreamPort}/v1`,
      );

      const proxyRequest = http.request(
        new URL(asString(resource.ready.proxy_url)),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-stainless-retry-count': '0',
          },
        },
        (response) => {
          response.on('data', () => {
            proxyRequest.destroy();
          });
        },
      );
      proxyRequest.end('{"test":true}');
      await waitFor(() => proxyRequest.destroyed, 3000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const telemetry = await stopEmbeddedMonitor(resource);
      await closeServer(upstream);

      expect(telemetry.total_requests).toBe(1);
      expect(telemetry.upstream_errors).toBe(0);
      expect(telemetry.responses_by_status).toEqual({ 200: 1 });
    });

    it('cleans startup resources for invalid targets and readiness timeouts', async () => {
      await expect(
        startEmbeddedMonitor('file:///tmp/not-http'),
      ).rejects.toThrow(/failed to start/);

      let spawned:
        | {
            child: {
              exitCode: number | null;
              signalCode: NodeJS.Signals | null;
              kill: (signal: string) => void;
            };
            directory: string;
          }
        | undefined;
      try {
        await expect(
          startEmbeddedMonitor('https://provider.invalid/v1', {
            startupTimeoutMs: 100,
            monitorReadyFileName: 'unobserved-ready.json',
            onSpawn: (resource) => {
              spawned = resource;
            },
          }),
        ).rejects.toThrow(/monitor failed to start.*timed out/i);
        expect(spawned).toBeDefined();
        expect(
          spawned?.child.exitCode ?? spawned?.child.signalCode,
        ).not.toBeNull();
        expect(fs.existsSync(spawned?.directory ?? '')).toBe(false);
      } finally {
        if (
          spawned &&
          spawned?.child.exitCode === null &&
          spawned?.child.signalCode === null
        ) {
          spawned?.child.kill('SIGTERM');
          await waitFor(
            () =>
              spawned?.child.exitCode !== null ||
              spawned?.child.signalCode !== null,
          );
        }
        if (spawned) {
          fs.rmSync(spawned?.directory, { recursive: true, force: true });
        }
      }
    });
  });

  describe('synchronous OCR command wall timing', () => {
    function readTimingArtifact(timingPath: fs.PathOrFileDescriptor) {
      let content;
      try {
        content = fs.readFileSync(timingPath, 'utf8');
      } catch (error: unknown) {
        throw new Error(
          `timing artifact is missing: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        );
      }
      let timing;
      try {
        timing = JSON.parse(content);
      } catch (error: unknown) {
        throw new Error(
          `timing artifact is malformed: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        );
      }
      if (!timing || !Number.isInteger(timing.exit_code)) {
        throw new Error('timing artifact is malformed: exit_code is required');
      }
      return timing;
    }

    function runTimedCommand(
      shellCommand: string,
      mutateTimingArtifact: (artifact: {
        directory: string;
        timingPath: string;
      }) => void = () => {},
    ) {
      const review = stepNamed(asRecord(codeReviewJob), 'Run OpenCodeReview');
      const source = extractEmbeddedSource(
        commandText(review),
        'ocr-command-timer.cjs',
        'TIMER',
      );
      return withTempDirectory(
        'ocr-command-timer-2673-',
        (directory: string) => {
          const scriptPath = path.join(directory, 'timer.cjs');
          const timingPath = path.join(directory, 'timing.json');
          fs.writeFileSync(scriptPath, source);
          try {
            execFileSync(
              process.execPath,
              [scriptPath, '/bin/sh', '-c', shellCommand],
              {
                env: {
                  ...process.env,
                  OCR_TIMING_PATH: timingPath,
                  OCR_STDOUT_PATH: path.join(directory, 'stdout.log'),
                  OCR_STDERR_PATH: path.join(directory, 'stderr.log'),
                },
              },
            );
          } catch {
            // Nonzero and signaled commands are expected here; the timer artifact is the authoritative outcome under test.
          }
          mutateTimingArtifact({ directory, timingPath });
          const timing = readTimingArtifact(timingPath);
          return { exitCode: timing.exit_code, timing };
        },
      );
    }

    it('measures a sleeping successful command', () => {
      const { exitCode, timing } = runTimedCommand('sleep 0.05');
      expect(exitCode).toBe(0);
      expect(timing.exit_code).toBe(0);
      expect(timing.command_wall_seconds).toBeGreaterThanOrEqual(0.04);
    });

    it('persists normalized nonzero and signal exits and rejects invalid artifacts', () => {
      for (const testCase of [
        { command: 'sleep 0.02; exit 7', expectedExitCode: 7 },
        { command: 'kill -TERM $$', expectedExitCode: 125 },
      ]) {
        const { exitCode, timing } = runTimedCommand(testCase.command);
        expect(exitCode).toBe(testCase.expectedExitCode);
        expect(timing.exit_code).toBe(testCase.expectedExitCode);
        expect(timing.command_wall_seconds).toBeGreaterThanOrEqual(0);
      }

      for (const testCase of [
        {
          mutate: (timingPath: string) => fs.rmSync(timingPath),
          expected: /timing artifact is missing/i,
        },
        {
          mutate: (timingPath: string) => fs.writeFileSync(timingPath, '{bad'),
          expected: /timing artifact is malformed/i,
        },
      ]) {
        let directory: string | undefined;
        try {
          expect(() =>
            runTimedCommand('exit 0', (artifact) => {
              directory = artifact.directory;
              testCase.mutate(artifact.timingPath);
            }),
          ).toThrow(testCase.expected);
          expect(fs.existsSync(directory ?? '')).toBe(false);
        } finally {
          if (directory) {
            fs.rmSync(directory, { recursive: true, force: true });
          }
        }
      }
    });
  });
});
