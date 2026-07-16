/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    expect(frame).not.toContain('Gemini API Key Notice');
    expect(frame).not.toContain('Google AI Studio');
    // Multi-provider-specific content must NOT be present.
    expect(frame).not.toContain('API Key Notice');
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

  it('renders ONLY the Gemini notice when gemini is the explicit active provider (mutually exclusive)', () => {
    const config = makeConfig('gemini');
    const { lastFrame } = renderWithProviders(
      <PrivacyNotice onExit={mockOnExit} config={config} />,
    );

    const frame = lastFrame();
    // Gemini notice is present.
    expect(frame).toContain('Gemini API Key Notice');
    // Neutral unconfigured notice must NOT be present.
    expect(frame).not.toContain('No provider is configured');
    // Multi-provider generic notice must NOT be present.
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
    // Gemini-specific notice must NOT be present.
    expect(frame).not.toContain('Gemini API Key Notice');
  });
});
