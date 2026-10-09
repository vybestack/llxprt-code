/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import {
  strictProbe,
  type StrictReceipt,
} from './source-strict-logger-fixture.js';

const root = sourceRootSetup();
function terminals(
  receipt: StrictReceipt,
): ReadonlyArray<Record<string, unknown>> {
  return receipt.events.filter(
    (event) =>
      ['token_usage', 'llxprt_code.api_response'].includes(
        String(event['event.name']),
      ) ||
      (event['event.name'] === 'conversation_response' &&
        event.success === true),
  );
}
function assertClosed(receipt: StrictReceipt): void {
  expect(receipt.closed).toBe(1);
  expect(receipt.activeReaders).toBe(0);
  expect(receipt.activeBodies).toBe(0);
}
const requestOrder = [
  'conversation_request',
  'conversation_request_complete',
  'llxprt_code.api_request',
  'llxprt_code.api_request_complete',
];

describe('source strict logger prerequisites with real HTTP and Config exporters', () => {
  it('rejects an exporter lacking artifact support in awaited source preflight before HTTP', async () => {
    const receipt = await strictProbe(root(), 'unsupported', true);
    expect(receipt.error?.message).toContain('exporter');
    expect(receipt.bodies).toHaveLength(0);
    expect(receipt.preflights).toBe(1);
    expect(receipt.retries).toBe(0);
    expect(receipt.output).toBe('');
    expect(receipt.events).toHaveLength(0);
    expect(terminals(receipt)).toHaveLength(0);
    assertClosed(receipt);
  }, 60000);

  it('preserves request-before-terminal ordering and response usage on a successful source seam', async () => {
    const receipt = await strictProbe(root(), 'none', true);
    expect(receipt.error).toBeNull();
    expect(receipt.bodies).toHaveLength(1);
    expect(receipt.output).toBe('finished');
    expect(receipt.events.map((event) => event['event.name'])).toStrictEqual([
      ...requestOrder,
      'token_usage',
      'llxprt_code.api_response',
      'conversation_response',
    ]);
    expect(
      receipt.events.find(
        (event) => event['event.name'] === 'llxprt_code.api_response',
      ),
    ).toMatchObject({
      model: 'gpt-5.6',
      input_token_count: 123,
      output_token_count: 1,
      total_token_count: 124,
    });
    assertClosed(receipt);
  }, 60000);

  it('prepares again for HTTP 503 and preserves identical complete uploads and response tokens', async () => {
    const receipt = await strictProbe(root(), 'retry', true);
    expect(receipt.error).toBeNull();
    expect(receipt.bodies).toHaveLength(2);
    expect(receipt.bodies[0]).toStrictEqual(receipt.bodies[1]);
    expect(receipt.preflights).toBe(2);
    expect(receipt.retries).toBe(1);
    expect(receipt.events.map((event) => event['event.name'])).toStrictEqual([
      ...requestOrder,
      'conversation_response',
      'llxprt_code.api_error',
      ...requestOrder,
      'token_usage',
      'llxprt_code.api_response',
      'conversation_response',
    ]);
    expect(
      receipt.events.find(
        (event) => event['event.name'] === 'llxprt_code.api_response',
      ),
    ).toMatchObject({
      model: 'gpt-5.6',
      input_token_count: 123,
      output_token_count: 1,
      total_token_count: 124,
    });
    assertClosed(receipt);
  }, 60000);

  it('recognizes post-upload abort without success or token events', async () => {
    const receipt = await strictProbe(root(), 'abort', true);
    expect(receipt.error?.name).toBe('AbortError');
    expect(receipt.bodies).toHaveLength(1);
    expect(terminals(receipt)).toHaveLength(0);
    expect(
      receipt.events.find(
        (event) => event['event.name'] === 'llxprt_code.api_error',
      ),
    ).toMatchObject({ error_type: 'consumer_abort' });
    assertClosed(receipt);
  }, 60000);
});

describe('eager logger filesystem failure controls', () => {
  it.each([
    'api-request',
    'conversation-request',
    'api-response',
    'conversation-response',
  ] as const)(
    'keeps preexisting eager fail-open behavior for actual %s write failure',
    async (fault) => {
      const receipt = await strictProbe(root(), fault, false);
      expect(receipt.writeFault).toBe('EISDIR');
      expect(receipt.error).toBeNull();
      expect(receipt.bodies).toHaveLength(1);
      expect(receipt.output).toBe('finished');
      assertClosed(receipt);
    },
    60000,
  );
});

if (process.env.ISSUE854_STRICT_REQUIRED === '1') {
  describe('required source failure propagation remains RED without a source terminal logging context', () => {
    it.each(['api-request', 'conversation-request'] as const)(
      'rejects source %s logging failure without upload, success or completion',
      async (fault) => {
        const receipt = await strictProbe(root(), fault, true);
        expect(receipt.writeFault).toBe('EISDIR');
        expect(receipt.error).not.toBeNull();
        expect(receipt.bodies).toHaveLength(0);
        expect(receipt.output).toBe('');
        expect(terminals(receipt)).toHaveLength(0);
        expect(
          receipt.events.some((event) =>
            String(event['event.name']).endsWith('_complete'),
          ),
        ).toBe(false);
        assertClosed(receipt);
      },
      60000,
    );
    it.each(['api-response', 'conversation-response'] as const)(
      'surfaces source post-attempt %s write failure before success or token commitment',
      async (fault) => {
        const receipt = await strictProbe(root(), fault, true);
        expect(receipt.writeFault).toBe('EISDIR');
        expect(receipt.bodies).toHaveLength(1);
        expect(receipt.error).not.toBeNull();
        expect(terminals(receipt)).toHaveLength(0);
        assertClosed(receipt);
      },
      60000,
    );
  });
}
