/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  emitHostFeedback,
  openHostBrowser,
  registerMcpHostServices,
  resetMcpHostServices,
} from './hostServices.js';

interface CapturedCall {
  readonly severity: string;
  readonly message: string;
  readonly argsLength: number;
  readonly error?: unknown;
}

describe('MCP host services', () => {
  afterEach(() => {
    resetMcpHostServices();
  });

  it('forwards feedback with the caller exact argument count', () => {
    const calls: CapturedCall[] = [];
    registerMcpHostServices({
      emitFeedback: (...args) => {
        calls.push({
          severity: args[0],
          message: args[1],
          argsLength: args.length,
          ...(args.length === 3 ? { error: args[2] } : {}),
        });
      },
    });

    emitHostFeedback('info', 'two arguments');
    const failure = new Error('failure');
    emitHostFeedback('error', 'three arguments', failure);

    expect(calls).toEqual([
      {
        severity: 'info',
        message: 'two arguments',
        argsLength: 2,
      },
      {
        severity: 'error',
        message: 'three arguments',
        argsLength: 3,
        error: failure,
      },
    ]);
  });

  it('keeps a registered capability when another is registered separately', async () => {
    const openedUrls: string[] = [];
    registerMcpHostServices({
      openBrowser: async (url) => {
        openedUrls.push(url);
      },
    });
    registerMcpHostServices({ emitFeedback: () => {} });

    await openHostBrowser('https://example.test/oauth');

    expect(openedUrls).toEqual(['https://example.test/oauth']);
  });

  it('does not let a failing feedback sink interrupt MCP work', () => {
    registerMcpHostServices({
      emitFeedback: () => {
        throw new Error('host sink failed');
      },
    });

    expect(() => emitHostFeedback('warning', 'advisory')).not.toThrow();
  });

  it('delegates browser failures without changing them', async () => {
    const failure = new Error('browser unavailable');
    registerMcpHostServices({
      openBrowser: () => Promise.reject(failure),
    });

    await expect(openHostBrowser('https://example.test')).rejects.toBe(failure);
  });

  it('resets both capabilities to standalone defaults', async () => {
    registerMcpHostServices({
      emitFeedback: () => {
        throw new Error('registered sink should have been reset');
      },
      openBrowser: async () => {},
    });

    resetMcpHostServices();

    expect(() => emitHostFeedback('info', 'standalone feedback')).not.toThrow();
    const browserFailure = await openHostBrowser(
      'https://example.test/oauth?code_challenge=sensitive-challenge',
    ).catch((error: unknown) => error);
    expect(browserFailure).toBeInstanceOf(Error);
    expect(String(browserFailure)).toContain(
      'No browser launcher registered by the host',
    );
    expect(String(browserFailure)).not.toContain('sensitive-challenge');
  });
});
