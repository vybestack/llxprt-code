/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { AggregateDisposeError } from '../disposeErrors.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  failCredentialProxyShutdown,
  observeCredentialProxyStarts,
} from './helpers/owned-credential-fixture.js';
import { withGenerateOptionsAgent } from './helpers/generate-options-agent.js';

describe('generation fixture acquisition cleanup', () => {
  useRecordingPrompts();
  it('keeps the scenario failure before a credential shutdown failure', async () => {
    const primary = new Error('generation scenario failed');
    const secondary = new Error('credential shutdown failed');
    const shutdown = failCredentialProxyShutdown(secondary);
    let failure: unknown;
    try {
      await withGenerateOptionsAgent(async () => {
        throw primary;
      });
    } catch (error) {
      failure = error;
    } finally {
      shutdown.mockRestore();
    }
    const leaves = (error: unknown): unknown[] =>
      error instanceof AggregateDisposeError || error instanceof AggregateError
        ? error.errors.flatMap(leaves)
        : [error];
    expect(leaves(failure)).toStrictEqual([primary, secondary]);
  });
  it('closes the actual credential endpoint and restores the source when provider registration fails', async () => {
    const previousSource = process.env.LLXPRT_FAKE_RESPONSES;
    const priorSource = fileURLToPath(
      new URL('./fixtures/plain-text.jsonl', import.meta.url),
    );
    process.env.LLXPRT_FAKE_RESPONSES = priorSource;
    const failure = new Error('provider registration failed');
    const capture = observeCredentialProxyStarts();
    const { servers, endpoints } = capture;
    const registration = spyOn(
      ProviderManager.prototype,
      'registerProvider',
    ).mockImplementationOnce(() => {
      throw failure;
    });
    try {
      await expect(
        withGenerateOptionsAgent(async () => {
          throw new Error('Failed acquisition must not publish a scenario');
        }),
      ).rejects.toBe(failure);
      expect(endpoints).toHaveLength(1);
      expect(existsSync(endpoints[0])).toBe(false);
      expect(servers[0].getSocketPath()).toBeNull();
      expect(process.env.LLXPRT_FAKE_RESPONSES).toBe(priorSource);
    } finally {
      registration.mockRestore();
      capture.mockRestore();
      if (previousSource === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousSource;
      await Promise.all(servers.map((server) => server.stop()));
    }
  });
});
