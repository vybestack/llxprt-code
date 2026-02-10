/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from 'ink';
import { type Config } from '@vybestack/llxprt-code-core';
import { GeminiPrivacyNotice } from './GeminiPrivacyNotice.js';
import { MultiProviderPrivacyNotice } from './MultiProviderPrivacyNotice.js';

interface PrivacyNoticeProps {
  onExit: () => void;
  config: Config;
}

/**
 * Privacy notice component that shows appropriate notice based on active provider.
 */
const PrivacyNoticeText = ({
  config,
  onExit,
}: {
  config: Config;
  onExit: () => void;
}) => {
  // Check active provider to determine which privacy notice to show
  const providerManager = config.getProviderManager?.();
  const activeProvider = providerManager?.getActiveProvider?.();

  // If we have a non-Gemini provider active, show its specific notice
  if (activeProvider && activeProvider.name !== 'gemini') {
    return (
      <MultiProviderPrivacyNotice
        providerName={activeProvider.name}
        onExit={onExit}
      />
    );
  }

  // Default to Gemini privacy notice (covers OAuth, API key, Vertex AI)
  return <GeminiPrivacyNotice onExit={onExit} />;
};

export const PrivacyNotice = ({ onExit, config }: PrivacyNoticeProps) => (
  <Box borderStyle="round" padding={1} flexDirection="column">
    <PrivacyNoticeText config={config} onExit={onExit} />
  </Box>
);
