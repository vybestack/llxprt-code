/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { renderWithProviders } from '../../test-utils/render.js';
import { PrivacyNotice } from './PrivacyNotice.js';
import type { ModelState } from '../cliUiRuntime.js';

function makeConfig(activeProviderName: string | undefined): ModelState {
  const providerManager = {
    getActiveProvider: () =>
      activeProviderName === undefined
        ? undefined
        : { name: activeProviderName },
    getActiveProviderName: () => activeProviderName,
    hasActiveProvider: () => activeProviderName !== undefined,
  };
  return {
    getProviderManager: () => providerManager,
  } as unknown as ModelState;
}

describe('PrivacyNotice: unconfigured state (#2481)', () => {
  const mockOnExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ONLY the neutral setup notice when no provider is active (mutually exclusive)', () => {
    const config = makeConfig(undefined);
    const { lastFrame } = renderWithProviders(
      <PrivacyNotice onExit={mockOnExit} config={config} />,
    );

    const frame = lastFrame();
    // Neutral notice content is present.
    expect(frame).toContain('No provider is configured');
    expect(frame).toContain('/setup');
    // Gemini-specific content must NOT be present.
    expect(frame).not.toContain('Active Provider: Gemini');
    expect(frame).not.toContain('ai.google.dev/gemini-api/terms');
    // Multi-provider-specific content must NOT be present.
    expect(frame).not.toContain('Active Provider: OpenAI');
  });

  it('uses the canonical vybestack docs URL (not a stale fork URL)', () => {
    const config = makeConfig(undefined);
    const { lastFrame } = renderWithProviders(
      <PrivacyNotice onExit={mockOnExit} config={config} />,
    );

    const frame = lastFrame();
    expect(frame).toContain(
      'https://github.com/vybestack/llxprt-code/blob/main/docs/tos-privacy.md',
    );
    expect(frame).not.toContain('github.com/acoliver/llxprt-code');
  });

  it('renders ONLY the Gemini consent content when gemini is the explicit active provider (mutually exclusive)', () => {
    const config = makeConfig('gemini');
    const { lastFrame } = renderWithProviders(
      <PrivacyNotice onExit={mockOnExit} config={config} />,
    );

    const frame = lastFrame();
    // Gemini consent content is present via the provider-parameterized notice.
    expect(frame).toContain('Active Provider: Gemini');
    expect(frame).toContain('Gemini API Additional Terms of Service');
    expect(frame).toContain('https://developers.google.com/terms');
    expect(frame).toContain('https://ai.google.dev/gemini-api/terms');
    expect(frame).toContain('https://ai.google.dev/docs/gemini_api_overview');
    expect(frame).toContain('https://aistudio.google.com/');
    // Neutral unconfigured notice must NOT be present.
    expect(frame).not.toContain('No provider is configured');
    // Other providers' content must NOT be present.
    expect(frame).not.toContain('OpenAI');
  });

  it('renders ONLY the MultiProvider notice for non-gemini active provider (mutually exclusive)', () => {
    const config = makeConfig('openai');
    const { lastFrame } = renderWithProviders(
      <PrivacyNotice onExit={mockOnExit} config={config} />,
    );

    const frame = lastFrame();
    // Multi-provider notice is present.
    expect(frame).toContain('OpenAI');
    // Neutral unconfigured notice must NOT be present.
    expect(frame).not.toContain('No provider is configured');
    // Gemini-specific content must NOT be present.
    expect(frame).not.toContain('Active Provider: Gemini');
    expect(frame).not.toContain('ai.google.dev/gemini-api/terms');
  });
});
