/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression coverage for issue #2033 Phase 2 relocation.
 *
 * Before the relocation, provider manager composition read provider settings
 * from the CLI's merged-settings view, which layered SETTINGS_SCHEMA defaults
 * over the raw user file. These tests pin the equivalent defaults at the
 * composition boundary now that it reads raw user settings directly.
 */

import { describe, expect, it } from 'bun:test';
import { resolveOpenaiSettings } from './providerManagerInstance.js';

describe('providerManagerInstance schema-default behavior (issue #2033)', () => {
  it('supplies SETTINGS_SCHEMA defaults when the user settings file is absent', () => {
    const { openaiProviderConfig } = resolveOpenaiSettings(
      undefined,
      undefined,
      false,
      false,
    );

    expect(openaiProviderConfig.enableTextToolCallParsing).toBe(false);
    expect(openaiProviderConfig.textToolCallModels).toStrictEqual([]);
    expect(openaiProviderConfig.providerToolFormatOverrides).toStrictEqual({});
    expect(openaiProviderConfig.openaiResponsesEnabled).toBe(false);
  });

  it('honors explicit user-file values over the schema defaults', () => {
    const { openaiProviderConfig } = resolveOpenaiSettings(
      undefined,
      {
        enableTextToolCallParsing: true,
        textToolCallModels: ['some-model'],
        providerToolFormatOverrides: { openai: 'hermes' },
        openaiResponsesEnabled: true,
      },
      false,
      false,
    );

    expect(openaiProviderConfig.enableTextToolCallParsing).toBe(true);
    expect(openaiProviderConfig.textToolCallModels).toStrictEqual([
      'some-model',
    ]);
    expect(openaiProviderConfig.providerToolFormatOverrides).toStrictEqual({
      openai: 'hermes',
    });
    expect(openaiProviderConfig.openaiResponsesEnabled).toBe(true);
  });
});
