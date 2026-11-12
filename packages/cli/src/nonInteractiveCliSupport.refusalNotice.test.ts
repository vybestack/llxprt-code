/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036, headless path. Refusal-recovery notices (retry progress, the
 * summary when recovery gives up) go to stderr in text mode, become warning
 * events in stream-json, stay off stdout in plain JSON, and are suppressed by
 * --quiet. Notices without a source keep being ignored.
 *
 * Drives the real `processAgentStream` with a scripted public event stream;
 * only `process.stdout` and `process.stderr` are captured.
 */

import { StreamJsonFormatter } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { processAgentStream } from './nonInteractiveCliSupport.js';
import { createStreamSettingsFixture } from './__tests__/stream-settings-fixture.js';

const RETRY_NOTICE: AgentEvent = {
  type: 'notice',
  source: 'refusal-recovery',
  message: 'Model m refused the request; retrying in 15 s (retry 1 of 2).',
};

async function* streamOf(
  events: readonly AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const event of events) yield event;
}

describe('processAgentStream refusal-recovery notices (issue #4036)', () => {
  let stdout: string[];
  let stderr: string[];
  let stdoutSpy: ReturnType<typeof spyOn<typeof process.stdout, 'write'>>;
  let stderrSpy: ReturnType<typeof spyOn<typeof process.stderr, 'write'>>;

  beforeEach(() => {
    stdout = [];
    stderr = [];
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(((
      chunk: unknown,
    ) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((
      chunk: unknown,
    ) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  async function run(
    events: readonly AgentEvent[],
    mode: {
      quiet?: boolean;
      jsonOutput?: boolean;
      streamFormatter?: StreamJsonFormatter | null;
    } = {},
  ): Promise<void> {
    const streamFormatter = mode.streamFormatter ?? null;
    await processAgentStream(
      streamOf([...events, { type: 'done', reason: 'stop' }]),
      {
        ...createStreamSettingsFixture({ sessionId: 'notice-session' }),
        jsonOutput: mode.jsonOutput ?? false,
        streamJsonOutput: streamFormatter !== null,
        quiet: mode.quiet ?? false,
        streamFormatter,
        emojiFilter: undefined,
        createProfileNameWriter: () => () => {},
      },
      Date.now(),
      () => new UiTelemetryService().getMetrics(),
    );
  }

  it('writes the notice to stderr in text mode and keeps stdout for the answer', async () => {
    await run([RETRY_NOTICE, { type: 'text', text: 'the answer' }]);

    expect(stderr.join('')).toContain(
      'Model m refused the request; retrying in 15 s (retry 1 of 2).',
    );
    expect(stdout.join('')).toBe('the answer\n');
  });

  it('writes nothing for the notice under --quiet', async () => {
    await run([RETRY_NOTICE, { type: 'text', text: 'the answer' }], {
      quiet: true,
    });

    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toBe('the answer\n');
  });

  it('emits a warning event in stream-json', async () => {
    await run([RETRY_NOTICE], { streamFormatter: new StreamJsonFormatter() });

    const warnings = stdout
      .join('')
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event['severity'] === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: 'error',
      severity: 'warning',
      message: 'Model m refused the request; retrying in 15 s (retry 1 of 2).',
    });
    expect(stderr.join('')).toBe('');
  });

  it('keeps plain JSON stdout to the single result object', async () => {
    await run([RETRY_NOTICE, { type: 'text', text: 'the answer' }], {
      jsonOutput: true,
    });

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed['response']).toBe('the answer');
    expect(stdout.join('')).not.toContain('retrying');
    expect(stderr.join('')).toBe('');
  });

  it('ignores a notice that has no source', async () => {
    await run([{ type: 'notice', message: 'MCP server x discovery failed' }]);

    expect(stderr.join('')).toBe('');
  });
});
