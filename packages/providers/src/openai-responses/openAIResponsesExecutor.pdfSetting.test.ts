/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { captureResponsesRequest } from './responses-request.js';
import { isResponsesPdfEnabled } from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

function buildOptions(
  setting?: boolean,
  ephemerals: Record<string, unknown> = {},
  modelBehavior?: boolean,
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  if (setting !== undefined) settings.set('media.pdf.enabled', setting);
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId: 'pdf-owner',
  });
  const invocation = createRuntimeInvocationContext({
    runtimeId: runtime.runtimeId,
    runtimeMetadata: runtime.metadata,

    providerName: 'openai-responses',
    ephemeralsSnapshot: { ...settings.getAllGlobalSettings(), ...ephemerals },
  });
  return {
    contents: [],

    metadata: {},
    invocation: {
      ...invocation,
      modelBehavior:
        modelBehavior === undefined
          ? {}
          : { 'media.pdf.enabled': modelBehavior },
    },
    resolved: { model: 'gpt-5', authToken: 'token' },
  };
}

function pdfEnabled(options: NormalizedGenerateChatOptions): boolean {
  return isResponsesPdfEnabled(
    captureResponsesRequest(
      options,
      'openai-responses',
      'https://api.openai.com/v1',
      undefined,
      'gpt-5',
    ),
  );
}

describe('Responses PDF policy capture', () => {
  it('defaults to enabled when no PDF setting is supplied', () => {
    expect(() => pdfEnabled(buildOptions())).not.toThrow();
    expect(pdfEnabled(buildOptions())).toBe(true);
  });
  it('honors an explicit disable from the owner settings', () => {
    expect(pdfEnabled(buildOptions(false))).toBe(false);
  });
  it('prefers invocation ephemerals over owner settings', () => {
    expect(pdfEnabled(buildOptions(true, { 'media.pdf.enabled': false }))).toBe(
      false,
    );
  });
  it('prefers model behavior over owner settings', () => {
    expect(pdfEnabled(buildOptions(true, {}, false))).toBe(false);
  });
  it('prefers invocation ephemerals over model behavior in both directions', () => {
    expect(
      pdfEnabled(buildOptions(true, { 'media.pdf.enabled': false }, true)),
    ).toBe(false);
    expect(
      pdfEnabled(buildOptions(true, { 'media.pdf.enabled': true }, false)),
    ).toBe(true);
  });
});
