/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: `isResponsesPdfEnabled` reads the optional
 * `SettingsService.get` seam (issue #2817 remediation).
 *
 * `SettingsService.get` is declared optional on the structural settings
 * contract, so a settings object that omits `get` must not crash the
 * prompt-envelope projection path — the setting simply falls through to its
 * default. Projection now gates compression and hard context-window
 * enforcement, so a TypeError here would take down the whole send.
 */

import { describe, expect, it } from 'vitest';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { isResponsesPdfEnabled } from './openAIResponsesExecutor.js';

function buildOptions(
  settings: unknown,
  ephemerals: Record<string, unknown> = {},
  modelBehavior: unknown = undefined,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    settings,
    metadata: {},
    invocation: {
      ephemerals,
      getModelBehavior: () => modelBehavior,
    },
    resolved: { model: 'gpt-5', authToken: 'token' },
  } as unknown as NormalizedGenerateChatOptions;
}

describe('isResponsesPdfEnabled optional settings seam (issue #2817)', () => {
  it('defaults to enabled when settings omits the optional get method', () => {
    const settingsWithoutGet = { set: () => {} };

    expect(() =>
      isResponsesPdfEnabled(buildOptions(settingsWithoutGet)),
    ).not.toThrow();
    expect(isResponsesPdfEnabled(buildOptions(settingsWithoutGet))).toBe(true);
  });

  it('honors an explicit disable from a settings service that implements get', () => {
    const settings = {
      get: (key: string) => (key === 'media.pdf.enabled' ? false : undefined),
    };

    expect(isResponsesPdfEnabled(buildOptions(settings))).toBe(false);
  });

  it('prefers invocation ephemerals over the settings service', () => {
    const settings = { get: () => true };

    expect(
      isResponsesPdfEnabled(
        buildOptions(settings, { 'media.pdf.enabled': false }),
      ),
    ).toBe(false);
  });

  it('prefers model behavior over the settings service', () => {
    const settings = { get: () => true };

    expect(isResponsesPdfEnabled(buildOptions(settings, {}, false))).toBe(
      false,
    );
  });
});
