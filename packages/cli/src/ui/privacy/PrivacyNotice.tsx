/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from 'ink';
import { type Config, AuthType } from '@vybestack/llxprt-code-core';
import { GeminiPrivacyNotice } from './GeminiPrivacyNotice.js';
import { CloudPaidPrivacyNotice } from './CloudPaidPrivacyNotice.js';
import { CloudFreePrivacyNotice } from './CloudFreePrivacyNotice.js';
import { MultiProviderPrivacyNotice } from './MultiProviderPrivacyNotice.js';

interface PrivacyNoticeProps {
  onExit: () => void;
  config: Config;
}

const PrivacyNoticeText = ({
  config,
  onExit,
}: {
  config: Config;
  onExit: () => void;
}) => {
  const authType = config.getContentGeneratorConfig()?.authType;

  // Check if we're using a non-Gemini provider or llxprt multi-provider
  const providerManager = config.getProviderManager?.();
  const activeProvider = providerManager?.getActiveProvider?.();
  const isNonGeminiProvider =
    activeProvider && activeProvider.name !== 'gemini';

  // For llxprt multi-provider or when content generator is not initialized,
  // show the basic Gemini privacy notice
  if (!authType || authType === AuthType.USE_PROVIDER || isNonGeminiProvider) {
    // If we have a specific non-Gemini provider, show its notice
    if (isNonGeminiProvider) {
      return (
        <MultiProviderPrivacyNotice
          providerName={activeProvider.name}
          onExit={onExit}
        />
      );
    }
    // Otherwise show basic Gemini API terms
    return <GeminiPrivacyNotice onExit={onExit} />;
  }

  switch (authType) {
    case AuthType.USE_GEMINI:
      return <GeminiPrivacyNotice onExit={onExit} />;
    case AuthType.USE_VERTEX_AI:
      return <CloudPaidPrivacyNotice onExit={onExit} />;
    case AuthType.LOGIN_WITH_GOOGLE:
    default:
      return <CloudFreePrivacyNotice config={config} onExit={onExit} />;
  }
};

export const PrivacyNotice = ({ onExit, config }: PrivacyNoticeProps) => (
  <Box borderStyle="round" padding={1} flexDirection="column">
    <PrivacyNoticeText config={config} onExit={onExit} />
  </Box>
);
