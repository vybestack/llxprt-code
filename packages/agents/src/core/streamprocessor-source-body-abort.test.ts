/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/projection-ownership-fixture.js';
import { observeDiskBody } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-body-observer.js';
import {
  processorFixture,
  sourcePending,
} from './streamprocessor-source-fixture.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
describe('actual StreamProcessor abort during progressive BODY', () => {
  it('closes request history and transport ownership when cancelled at first BODY demand', async () => {
    const http = projectionEndpoint(false);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
      false,
      1,
    );
    const observer = observeDiskBody();
    const controller = new AbortController();
    const started = setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Answer',
        config: {
          requestHistorySource: 'responses-disk-text',
          abortSignal: controller.signal,
        },
      },
      'body-abort',
      sourcePending,
    );
    void started.catch(() => undefined);
    try {
      await Promise.race([
        observer.first.wait,
        started.then(() => {
          throw new Error('Missing actual BODY demand');
        }),
      ]);
      expect(observer.state.bytes).toBeGreaterThan(0);
      controller.abort(new Error('cancel actual body'));
      observer.resume.release();
      http.readBody.release();
      http.respond.release();
      await expect(started).rejects.toThrow(/(?:cancel actual body|abort)/i);
      expect(setup.processor.getPromptEnvelopeEstimate()).toBeNull();
      expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      controller.abort();
      observer.resume.release();
      http.readBody.release();
      http.respond.release();
      const stream = await started.catch(() => undefined);
      await stream?.return(undefined);
      observer.restore();
      setup.history.dispose();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 60000);
});
