/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as host from './hostServices.js';

describe('MCP explicit host capabilities', () => {
  it('does not expose process-wide host registration', () => {
    expect(Object.keys(host)).not.toContain('registerMcpHostServices');
    expect(Object.keys(host)).not.toContain('resetMcpHostServices');
    expect(Object.keys(host)).not.toContain('emitHostFeedback');
    expect(Object.keys(host)).not.toContain('openHostBrowser');
  });

  it('keeps a failing owner feedback sink from interrupting work', () => {
    const feedback = host.captureHostFeedback(() => {
      throw new Error('host sink failed');
    });
    expect(() => feedback('warning', 'advisory')).not.toThrow();
  });

  it('rejects a missing explicit browser launcher without leaking the URL', async () => {
    const failure = await host
      .defaultBrowserLauncher('https://example.test/?code_challenge=sensitive')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      'No browser launcher registered by the host',
    );
    expect(String(failure)).not.toContain('sensitive');
  });
});
