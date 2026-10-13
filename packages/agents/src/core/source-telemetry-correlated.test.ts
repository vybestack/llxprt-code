/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { correlatedProbe } from './__tests__/support/source-telemetry-correlated-fixture.js';

const root = sourceRootSetup();
function closed(receipt: Awaited<ReturnType<typeof correlatedProbe>>): void {
  expect(receipt.closed).toStrictEqual([1, 1]);
  expect(receipt.activeReaders).toBe(0);
  expect(receipt.activeBodies).toBe(0);
}
function failedAttempt(
  receipt: Awaited<ReturnType<typeof correlatedProbe>>,
): void {
  const first = receipt.starts.find(
    (attempt) => attempt.promptId === 'corr-first',
  );
  expect(first).toBeUndefined();
  expect(
    receipt.ends.find((attempt) => attempt.promptId === 'corr-second'),
  ).toMatchObject({ status: 'success', inputTokens: 123, outputTokens: 1 });
  expect(
    receipt.rejected.every(
      (event) => typeof event['llxprt.export_receipt_id'] === 'string',
    ),
  ).toBe(true);
}
describe('request-correlated source telemetry with one SDK Config and FileLogExporter', () => {
  for (const secondSource of [false, true]) {
    for (const fault of ['pre', 'late', 'missing'] as const) {
      it(`rejects only the source with ${fault} export failure alongside ${secondSource ? 'source' : 'eager'}`, async () => {
        const receipt = await correlatedProbe(
          root(),
          fault,
          true,
          secondSource,
        );
        expect(receipt.fault).toBe('EISDIR');
        expect(
          receipt.rejected.some((event) =>
            String(event.prompt_id).startsWith('corr-first'),
          ),
        ).toBe(true);
        expect(receipt.first.error).not.toBeNull();
        expect(receipt.first.error?.message).toMatch(
          fault.endsWith('missing') ? /acknowledgement|timeout/i : /EISDIR/,
        );
        expect(receipt.first.usage).toStrictEqual([]);
        expect(receipt.first.finishes).toStrictEqual([]);
        expect(receipt.other.error).toBeNull();
        expect(receipt.other.output).toBe('finished');
        expect(receipt.other.usage).toContainEqual({
          promptTokens: 123,
          completionTokens: 1,
          totalTokens: 124,
          cachedTokens: 0,
        });
        expect(receipt.bodies).toHaveLength(1);
        expect(receipt.sessionTokens.total).toBe(124);
        expect(receipt.performance.totalRequests).toBe(1);
        expect(receipt.performance.errorRate).toBe(0);
        failedAttempt(receipt);
        closed(receipt);
      }, 60000);
    }
    for (const fault of ['post', 'post-late', 'post-missing'] as const) {
      it(`completes the source turn with ${fault} export failure alongside ${secondSource ? 'source' : 'eager'}`, async () => {
        const receipt = await correlatedProbe(
          root(),
          fault,
          true,
          secondSource,
        );
        expect(receipt.fault).toBe('EISDIR');
        expect(
          receipt.rejected.some((event) =>
            String(event.prompt_id).startsWith('corr-first'),
          ),
        ).toBe(true);
        for (const result of [receipt.first, receipt.other]) {
          expect(result.error).toBeNull();
          expect(result.output).toBe('finished');
          expect(result.usage).toContainEqual({
            promptTokens: 123,
            completionTokens: 1,
            totalTokens: 124,
            cachedTokens: 0,
          });
        }
        expect(receipt.bodies).toHaveLength(2);
        expect(receipt.sessionTokens.total).toBe(248);
        expect(receipt.performance.totalRequests).toBe(2);
        expect(receipt.performance.errorRate).toBe(0);
        for (const promptId of ['corr-first', 'corr-second']) {
          const started = receipt.starts.find(
            (attempt) => attempt.promptId === promptId,
          );
          expect(started).toBeDefined();
          expect(
            receipt.ends.find(
              (attempt) => attempt.attemptId === started?.attemptId,
            ),
          ).toMatchObject({
            status: 'success',
            inputTokens: 123,
            outputTokens: 1,
          });
        }
        closed(receipt);
      }, 60000);
    }
  }
  it.each(['pre', 'post'] as const)(
    'does not transfer an eager %s exporter failure to the overlapping source',
    async (fault) => {
      const receipt = await correlatedProbe(root(), fault, false, true);
      expect(receipt.fault).toBe('EISDIR');
      expect(receipt.first.error).toBeNull();
      expect(receipt.other.error).toBeNull();
      expect(receipt.bodies).toHaveLength(2);
      expect(receipt.sessionTokens.total).toBe(248);
      closed(receipt);
    },
    60000,
  );
  it('settles an external successful physical attempt as a success when its source response export fails', async () => {
    const receipt = await correlatedProbe(root(), 'post', true, true, true);
    expect(receipt.first.error).toBeNull();
    expect(receipt.first.output).toBe('finished');
    expect(receipt.other.error).toBeNull();
    expect(receipt.sessionTokens.total).toBe(248);
    expect(receipt.performance.errorRate).toBe(0);
    closed(receipt);
  }, 60000);
});

describe('strict source telemetry opt-in boundaries', () => {
  it('completes an API-only source turn when its success acknowledgement fails, without conversation logging', async () => {
    const receipt = await correlatedProbe(root(), 'post', true, true, false, {
      conversations: false,
    });
    expect(receipt.first.error).toBeNull();
    expect(receipt.first.output).toBe('finished');
    expect(receipt.other.error).toBeNull();
    expect(receipt.sessionTokens.total).toBe(248);
    expect(
      receipt.accepted.some(
        (event) => event['event.name'] === 'conversation_request',
      ),
    ).toBe(false);
    closed(receipt);
  }, 60000);
  it.each([{ apiBodies: false }, { prompts: false }])(
    'preserves telemetry fail-open without both body and prompt opt-ins: %j',
    async (options) => {
      const receipt = await correlatedProbe(
        root(),
        'post',
        true,
        true,
        false,
        options,
      );
      expect(receipt.fault).toBe('EISDIR');
      expect(receipt.first.error).toBeNull();
      expect(receipt.other.error).toBeNull();
      expect(receipt.sessionTokens.total).toBe(248);
      closed(receipt);
    },
    60000,
  );
});
