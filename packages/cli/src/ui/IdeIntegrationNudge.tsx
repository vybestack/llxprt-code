/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IdeInfo } from '@vybestack/llxprt-code-core';
import { Box, Text } from 'ink';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from './components/shared/RadioButtonSelect.js';
import { useKeypress } from './hooks/useKeypress.js';
import { Colors } from './colors.js';

export type IdeIntegrationNudgeResult = {
  userSelection: 'yes' | 'no' | 'dismiss';
  isExtensionPreInstalled: boolean;
};

interface IdeIntegrationNudgeProps {
  ide: IdeInfo;
  onComplete: (result: IdeIntegrationNudgeResult) => void;
}

export function IdeIntegrationNudge({
  ide,
  onComplete,
}: IdeIntegrationNudgeProps) {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onComplete({
          userSelection: 'no',
          isExtensionPreInstalled: false,
        });
      }
    },
    { isActive: true },
  );

  const { displayName: ideName } = ide;
  // Assume extension is already installed if the env variables are set.
  const isExtensionPreInstalled =
    !!process.env.LLXPRT_CODE_IDE_SERVER_PORT &&
    !!process.env.LLXPRT_CODE_IDE_WORKSPACE_PATH;

  const OPTIONS: Array<RadioSelectItem<IdeIntegrationNudgeResult>> = [
    {
      label: 'Yes',
      value: {
        userSelection: 'yes',
        isExtensionPreInstalled,
      },
      key: 'Yes',
    },
    {
      label: 'No (esc)',
      value: {
        userSelection: 'no',
        isExtensionPreInstalled,
      },
      key: 'No (esc)',
    },
    {
      label: "No, don't ask again",
      value: {
        userSelection: 'dismiss',
        isExtensionPreInstalled,
      },
      key: "No, don't ask again",
    },
  ];

  const installText = isExtensionPreInstalled
    ? `If you select Yes, the CLI will have access to your open files and display diffs directly in ${
        ideName ?? 'your editor'
      }.`
    : `If you select Yes, we'll install an extension that allows the CLI to access your open files and display diffs directly in ${
        ideName ?? 'your editor'
      }.`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentYellow}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Box marginBottom={1} flexDirection="column">
        <Text color={Colors.Foreground}>
          <Text color={Colors.AccentYellow}>{'> '}</Text>
          {`Do you want to connect ${ideName ?? 'your editor'} to LLxprt Code?`}
        </Text>
        <Text color={Colors.DimComment}>{installText}</Text>
      </Box>
      <RadioButtonSelect items={OPTIONS} onSelect={onComplete} />
    </Box>
  );
}
