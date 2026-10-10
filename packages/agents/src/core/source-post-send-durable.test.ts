/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { mixedPostSendProbe } from './__tests__/support/source-post-send-durable-fixture.js';

const root = sourceRootSetup();
type Receipt = Awaited<ReturnType<typeof mixedPostSendProbe>>;
function requestMessageCount(request: unknown): number {
  if (
    typeof request !== 'object' ||
    request === null ||
    !('messages' in request)
  )
    return -1;
  return Array.isArray(request.messages) ? request.messages.length : -1;
}
function assertUploadsAndCleanup(receipt: Receipt): void {
  function isSourceRequest(request: unknown): boolean {
    if (
      typeof request !== 'object' ||
      request === null ||
      !('context' in request)
    )
      return false;
    const context = request.context;
    if (
      typeof context !== 'object' ||
      context === null ||
      !('promptId' in context)
    )
      return false;
    return context.promptId === 'post-source';
  }
  expect(receipt.bodies).toHaveLength(2);
  expect(receipt.uploads).toBe(2);
  for (const body of receipt.bodies)
    expect(body).toStrictEqual({
      bytes: 37149,
      sha256:
        '6ed9f205ae00944fb40ec82f429c932ba449efda2818f4b40d425363d2e207da',
    });
  expect(receipt.sourceClosed).toBe(1);
  expect(receipt.eagerClosed).toBe(1);
  expect(receipt.activeReaders).toBe(0);
  expect(receipt.activeBodies).toBe(0);
  expect(receipt.artifacts).toHaveLength(3);
  expect(receipt.priorRequests).toHaveLength(3);
  expect(receipt.priorRequests.map(requestMessageCount)).toStrictEqual([
    64, 64, 64,
  ]);
  for (const request of receipt.priorRequests)
    expect(request).toStrictEqual(
      expect.objectContaining({
        type: 'request',
        messages: expect.arrayContaining([
          expect.objectContaining({ speaker: 'human' }),
        ]),
      }),
    );
  const sourceRequests = receipt.priorRequests.filter(isSourceRequest);
  expect(sourceRequests).toHaveLength(1);
  const names = [
    'conversation_request',
    'conversation_request_complete',
    'llxprt_code.api_request',
    'llxprt_code.api_request_complete',
  ];
  for (const prompt of ['post-source', 'post-eager'])
    expect(
      receipt.events
        .filter(
          (event) =>
            event.prompt_id === prompt &&
            names.includes(String(event['event.name'])),
        )
        .map((event) => event['event.name']),
    ).toStrictEqual(names);
}
function assertFailedAttempt(receipt: Receipt): void {
  const starts = receipt.attemptStarts.filter(
    (attempt) => attempt.promptId === 'post-source',
  );
  const ends = receipt.attemptEnds.filter(
    (attempt) => attempt.promptId === 'post-source',
  );
  expect(starts).toHaveLength(1);
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({
    attemptId: starts[0].attemptId,
    status: 'error',
    inputTokens: 123,
    outputTokens: 1,
  });
  const errors = receipt.events.filter(
    (event) =>
      event['event.name'] === 'llxprt_code.api_error' &&
      event.prompt_id === 'post-source',
  );
  expect(errors).toHaveLength(1);
  expect(errors[0].attempt_id).toBe(starts[0].attemptId);
}
function accepted(
  receipt: Receipt,
  prompt: string,
): ReadonlyArray<Record<string, unknown>> {
  return receipt.events.filter((event) => {
    if (event['event.name'] === 'token_usage')
      return event.conversation_id === prompt;
    return (
      [prompt, `${prompt}#a0`].includes(String(event.prompt_id)) &&
      ['llxprt_code.api_response', 'conversation_response'].includes(
        String(event['event.name']),
      ) &&
      event.success !== false
    );
  });
}

describe('request-local durable source response acknowledgement after real uploads', () => {
  it.each([false, true])(
    'rejects source with original durable EISDIR while shared eager completes (eager first: %s)',
    async (eagerFirst) => {
      const receipt = await mixedPostSendProbe(
        root(),
        'conversation-response',
        eagerFirst,
      );
      assertUploadsAndCleanup(receipt);
      assertFailedAttempt(receipt);
      expect(receipt.writeFault).toBe('EISDIR');
      expect(receipt.source.error).toMatchObject({
        code: 'EISDIR',
        path: receipt.faultPath,
        syscall: 'open',
      });
      expect(receipt.source.error?.stack).toContain('appendEntry');
      expect(receipt.source.usage).toHaveLength(0);
      expect(receipt.source.finishes).toHaveLength(0);
      expect(accepted(receipt, 'post-source')).toHaveLength(0);
      expect(
        receipt.events.filter((event) => event['event.name'] === 'token_usage'),
      ).toHaveLength(1);
      expect(receipt.eager.error).toBeNull();
      expect(receipt.eager.output).toBe('finished');
      expect(receipt.eager.usage).toHaveLength(1);
      const failed = receipt.events.filter(
        (event) =>
          event.prompt_id === 'post-source' &&
          event['event.name'] === 'llxprt_code.api_error',
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        error_type: 'stream_error',
        provider: 'openai-responses',
        model: 'gpt-5.6',
        input_token_count: 123,
        output_token_count: 1,
      });
      expect(failed[0].attempt_id).toBe('post-source#a0');
      expect(String(failed[0].error)).toContain('EISDIR');
      expect(receipt.performance.totalRequests).toBe(1);
      expect(receipt.performance.totalTokens).toBe(124);
      expect(receipt.performance.errorRate).toBe(0.5);
      expect(receipt.sessionTokens).toMatchObject({
        input: 123,
        output: 1,
        total: 124,
      });
    },
    60000,
  );
});

describe('source durable response with externally owned attempts', () => {
  it('attributes durable failure to the actual RetryOrchestrator attempt without an earlier success record', async () => {
    const receipt = await mixedPostSendProbe(
      root(),
      'conversation-response',
      false,
      true,
    );
    assertUploadsAndCleanup(receipt);
    assertFailedAttempt(receipt);
    expect(receipt.source.error?.code).toBe('EISDIR');
    expect(receipt.source.usage).toHaveLength(0);
    expect(
      receipt.events.filter((event) => event['event.name'] === 'token_usage'),
    ).toHaveLength(1);
    expect(
      receipt.events.filter(
        (event) => event['event.name'] === 'llxprt_code.api_response',
      ),
    ).toHaveLength(1);
    const errors = receipt.events.filter(
      (event) =>
        event.prompt_id === 'post-source' &&
        event['event.name'] === 'llxprt_code.api_error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      error_type: 'stream_error',
      input_token_count: 123,
      output_token_count: 1,
    });
    expect(typeof errors[0].attempt_id).toBe('string');
    expect(String(errors[0].error)).toContain('EISDIR');
    expect(receipt.eager.error).toBeNull();
    expect(receipt.performance.totalRequests).toBe(1);
    expect(receipt.sessionTokens.total).toBe(124);
  }, 60000);
});

describe('successful mixed source and eager durable responses', () => {
  it.each([false, true])(
    'preserves native successful usage, captured turns and exactly one response per request (external: %s)',
    async (externalLifecycle) => {
      const receipt = await mixedPostSendProbe(
        root(),
        'none',
        true,
        externalLifecycle,
      );
      assertUploadsAndCleanup(receipt);
      for (const result of [receipt.source, receipt.eager]) {
        expect(result.error).toBeNull();
        expect(result.output).toBe('finished');
        expect(result.usage).toHaveLength(1);
        expect(result.usage[0]).toMatchObject({
          promptTokens: 123,
          completionTokens: 1,
          totalTokens: 124,
        });
        expect(result.finishes).toStrictEqual(['stop']);
      }
      const responses: unknown[] = (receipt.conversationLog ?? '')
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line))
        .filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'type' in entry &&
            entry.type === 'response',
        );
      expect(responses).toHaveLength(2);
      expect(responses).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              promptId: 'post-eager',
              turnNumber: 1,
              success: true,
            }),
          }),
          expect.objectContaining({
            metadata: expect.objectContaining({
              promptId: 'post-source',
              turnNumber: 2,
              success: true,
            }),
          }),
        ]),
      );
      expect(
        receipt.events.filter(
          (event) => event['event.name'] === 'llxprt_code.api_response',
        ),
      ).toHaveLength(2);
      expect(
        receipt.events.filter((event) => event['event.name'] === 'token_usage'),
      ).toHaveLength(2);
      expect(receipt.performance.totalRequests).toBe(2);
      expect(receipt.performance.totalTokens).toBe(248);
      expect(receipt.sessionTokens).toMatchObject({
        input: 246,
        output: 2,
        total: 248,
      });
    },
    60000,
  );
});

describe('separate required telemetry response acknowledgement', () => {
  it('rejects source after post-upload exporter EISDIR before accepted terminals', async () => {
    const receipt = await mixedPostSendProbe(root(), 'api-response', false);
    expect(receipt.bodies).toHaveLength(2);
    expect(receipt.writeFault).toBe('EISDIR');
    expect(
      receipt.rejected.some((batch) => batch.error.includes('EISDIR')),
    ).toBe(true);
    expect(receipt.eager.error).toBeNull();
    expect(receipt.source.error).not.toBeNull();
    expect(receipt.source.usage).toHaveLength(0);
    expect(receipt.source.finishes).toHaveLength(0);
    expect(receipt.performance.totalRequests).toBe(1);
    expect(receipt.sessionTokens.total).toBe(124);
  }, 60000);
});
