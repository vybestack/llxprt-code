/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';

import { SemanticColors } from '../colors.js';
import type { LoadedSettings } from '../../config/settings.js';
import { Header } from './Header.js';
import { Tips } from './Tips.js';
import { useBanner, type BannerData } from '../hooks/useBanner.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

interface AppHeaderProps {
  config: CliUiRuntime;
  settings: LoadedSettings;
  version: string;
  nightly: boolean;
  terminalWidth: number;
  bannerData?: BannerData;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  config,
  settings,
  version,
  nightly,
  terminalWidth,
  bannerData,
}) => {
  const { bannerText } = useBanner(
    bannerData ?? { defaultText: '', warningText: '' },
  );

  return (
    <Box flexDirection="column">
      {!(
        settings.merged.ui.hideBanner === true || config.getScreenReader()
      ) && (
        <Header
          terminalWidth={terminalWidth}
          version={version}
          nightly={nightly}
        />
      )}
      {bannerText && (
        <Text color={SemanticColors.text.primary}>{bannerText}</Text>
      )}
      {!(settings.merged.ui.hideTips === true || config.getScreenReader()) && (
        <Tips memory={config} />
      )}
    </Box>
  );
};
