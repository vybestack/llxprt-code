/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { AggregateDisposeError } from '../disposeErrors.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

function messagesOf(error: unknown): string[] {
  if (error instanceof AggregateError || error instanceof AggregateDisposeError)
    return [error.message, ...error.errors.flatMap(messagesOf)];
  return [error instanceof Error ? error.message : String(error)];
}

describe('activation preflight cleanup failure reporting', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const routes: RouteBPreflight[] = [];
  const intent = { provider: 'fake', model: 'fake-model' };

  async function failingCleanupRoute(
    onTrustCleanup: () => void = () => {},
  ): Promise<RouteBPreflight> {
    const route = await openRouteBPreflight({
      config: {
        sessionId: 'preflight-cleanup-failure',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      },
    });
    routes.push(route);
    await route.prepare({
      trustCleanup: () => {
        onTrustCleanup();
        return Promise.reject(new Error('trust cleanup failed'));
      },
    });
    return route;
  }

  afterEach(async () => {
    for (const route of routes.splice(0).reverse()) await route.close();
  });

  it('reports a settings disposal rejection together with the other collected resource failures', async () => {
    const route = await failingCleanupRoute();
    const result = await route.preflight.preflight(intent);
    if (!result.token) throw new Error('Missing actual preflight token');
    const release = spyOn(route.settings, 'off').mockImplementation(() => {
      throw new Error('settings disposal failed');
    });
    let outcome: unknown;
    try {
      outcome = await route.disposePreflight().then(
        () => undefined,
        (error: unknown) => error,
      );
    } finally {
      release.mockRestore();
    }
    expect(outcome).toBeInstanceOf(AggregateError);
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
  });

  it('keeps the original adoption failure when preflight cleanup also fails', async () => {
    let release: { mockRestore(): void } | undefined;
    const route = await failingCleanupRoute(() => {
      release = spyOn(route.settings, 'off').mockImplementation(() => {
        throw new Error('settings disposal failed');
      });
    });
    let outcome: unknown;
    try {
      outcome = await route
        .createAgent(intent, { disposeGitHubBroker: async () => undefined })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    } finally {
      release?.mockRestore();
    }
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(messagesOf(outcome.errors[0])[0]).toContain(
      'GitHub transport disposal requires an explicit broker',
    );
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
  });
});
