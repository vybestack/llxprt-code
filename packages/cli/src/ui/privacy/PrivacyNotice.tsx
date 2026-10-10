/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from 'ink';

import { MultiProviderPrivacyNotice } from './MultiProviderPrivacyNotice.js';
import { UnconfiguredPrivacyNotice } from './UnconfiguredPrivacyNotice.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

interface PrivacyNoticeProps {
  onExit: () => void;
  provider: string | null | undefined;
}

/**
 * Privacy notice component that shows appropriate notice based on active provider.
 */
const PrivacyNoticeText = ({
  provider,
  onExit,
}: {
  provider: string | null | undefined;
  onExit: () => void;
}) => {
  const providerName = provider;
  if (!providerName || providerName === 'unconfigured') {
    return <UnconfiguredPrivacyNotice onExit={onExit} />;
  }

  return (
    <MultiProviderPrivacyNotice providerName={providerName} onExit={onExit} />
  );
};

export const PrivacyNotice = ({ onExit, provider }: PrivacyNoticeProps) => (
  <Box borderStyle={getBorderStyle('round')} padding={1} flexDirection="column">
    <PrivacyNoticeText provider={provider} onExit={onExit} />
  </Box>
);
