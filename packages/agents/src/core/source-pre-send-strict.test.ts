/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { mixedPreSendProbe } from './__tests__/support/source-pre-send-strict-fixture.js';

const root = sourceRootSetup();
describe('request-local pre-send strict policy with shared wrapper Config and exporter', () => {
  it.each([false, true])(
    'rejects durable source EISDIR before HTTP while overlapping eager returns (eager first: %s)',
    async (eagerFirst) => {
      const receipt = await mixedPreSendProbe(
        root(),
        'conversation-request',
        eagerFirst,
      );
      expect(receipt.writeFault).toBe('EISDIR');
      expect(receipt.source.error?.code).toBe('EISDIR');
      expect(receipt.source.output).toBe('');
      expect(receipt.eager.error).toBeNull();
      expect(receipt.eager.output).toBe('finished');
      expect(receipt.bodies).toHaveLength(1);
      expect(receipt.bodies[0]).toStrictEqual({
        bytes: 37149,
        sha256:
          '6ed9f205ae00944fb40ec82f429c932ba449efda2818f4b40d425363d2e207da',
      });
      expect(
        receipt.events.filter((event) => event.prompt_id === 'mixed-source'),
      ).toHaveLength(0);
      expect(receipt.sourceClosed).toBe(1);
      expect(receipt.activeReaders).toBe(0);
      expect(receipt.activeBodies).toBe(0);
    },
    60000,
  );
});

describe('independent API-only logging and cancellation', () => {
  it('requires the API-only durable append for source while eager remains fail-open', async () => {
    const receipt = await mixedPreSendProbe(
      root(),
      'api-durable-request',
      false,
    );
    expect(receipt.writeFault).toBe('EISDIR');
    expect(receipt.source.error?.code).toBe('EISDIR');
    expect(receipt.source.output).toBe('');
    expect(receipt.eager.error).toBeNull();
    expect(receipt.eager.output).toBe('finished');
    expect(receipt.bodies).toHaveLength(1);
    expect(
      receipt.events.filter((event) => event.prompt_id === 'mixed-source'),
    ).toHaveLength(0);
    expect(receipt.sourceClosed).toBe(1);
    expect(receipt.eagerClosed).toBe(1);
    expect(receipt.activeReaders).toBe(0);
    expect(receipt.activeBodies).toBe(0);
  }, 60000);

  it('cancels only the prepared source request while overlapping eager uploads', async () => {
    const receipt = await mixedPreSendProbe(root(), 'abort', false);
    expect(receipt.source.error?.name).toBe('AbortError');
    expect(receipt.source.output).toBe('');
    expect(receipt.eager.error).toBeNull();
    expect(receipt.eager.output).toBe('finished');
    expect(receipt.bodies).toHaveLength(1);
    expect(
      receipt.events.filter((event) => event.prompt_id === 'mixed-source'),
    ).toHaveLength(0);
    expect(receipt.sourceClosed).toBe(1);
    expect(receipt.eagerClosed).toBe(1);
    expect(receipt.activeReaders).toBe(0);
    expect(receipt.activeBodies).toBe(0);
  }, 60000);
});

describe('source request artifact reuse', () => {
  it('shares one complete source artifact between conversation and API without changing eager staging', async () => {
    const receipt = await mixedPreSendProbe(root(), 'none', true);
    expect(receipt.source.error).toBeNull();
    expect(receipt.eager.error).toBeNull();
    expect(receipt.source.output).toBe('finished');
    expect(receipt.eager.output).toBe('finished');
    expect(receipt.bodies).toHaveLength(2);
    expect(receipt.bodies[0]).toStrictEqual(receipt.bodies[1]);
    expect(receipt.artifacts).toHaveLength(3);
    const source = receipt.events.filter(
      (event) =>
        event.prompt_id === 'mixed-source' &&
        [
          'conversation_request_complete',
          'llxprt_code.api_request_complete',
        ].includes(String(event['event.name'])),
    );
    expect(source).toHaveLength(2);
    expect(source[0].artifact_id).toBe(source[1].artifact_id);
    expect(source[0].row_count).toBe(64);
    expect(source[0].content_bytes).toBeGreaterThan(30000);
    expect(receipt.sourceClosed).toBe(1);
    expect(receipt.activeReaders).toBe(0);
    expect(receipt.activeBodies).toBe(0);
  }, 60000);
});

if (process.env.ISSUE854_PRE_SEND_TELEMETRY_REQUIRED === '1') {
  describe('required request-correlated telemetry acknowledgement', () => {
    it('rejects source telemetry EISDIR before HTTP while overlapping eager remains fail-open', async () => {
      const receipt = await mixedPreSendProbe(root(), 'api-request', false);
      expect(receipt.writeFault).toBe('EISDIR');
      expect(
        receipt.rejected.some((batch) => batch.error.includes('EISDIR')),
      ).toBe(true);
      expect(receipt.eager.error).toBeNull();
      expect(receipt.eager.output).toBe('finished');
      expect(receipt.source.error).not.toBeNull();
      expect(receipt.source.output).toBe('');
      expect(receipt.bodies).toHaveLength(1);
      expect(receipt.sourceClosed).toBe(1);
      expect(receipt.activeReaders).toBe(0);
      expect(receipt.activeBodies).toBe(0);
    }, 60000);
  });
}
