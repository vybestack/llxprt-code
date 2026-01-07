/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Newline, Text } from 'ink';
import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface CloudPaidPrivacyNoticeProps {
  onExit: () => void;
}

export const CloudPaidPrivacyNotice = ({
  onExit,
}: CloudPaidPrivacyNoticeProps) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onExit();
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        Vertex AI Notice
      </Text>
      <Newline />
      <Text color={Colors.Foreground}>
        Service Specific Terms<Text color={Colors.AccentBlue}>[1]</Text> are
        incorporated into the agreement under which Google has agreed to provide
        Google Cloud Platform<Text color={Colors.AccentGreen}>[2]</Text> to
        Customer (the &quot;Agreement&quot;). If the Agreement authorizes the
        resale or supply of Google Cloud Platform under a Google Cloud partner
        or reseller program, then except for in the section entitled
        &quot;Partner-Specific Terms&quot;, all references to Customer in the
        Service Specific Terms mean Partner or Reseller (as applicable), and all
        references to Customer Data in the Service Specific Terms mean Partner
        Data. Capitalized terms used but not defined in the Service Specific
        Terms have the meaning given to them in the Agreement.
      </Text>
      <Newline />
      <Text color={Colors.Foreground}>
        <Text color={Colors.AccentBlue}>[1]</Text>{' '}
        https://cloud.google.com/terms/service-terms
      </Text>
      <Text color={Colors.Foreground}>
        <Text color={Colors.AccentGreen}>[2]</Text>{' '}
        https://cloud.google.com/terms/services
      </Text>
      <Newline />
      <Text color={Colors.Gray}>Press Esc to exit.</Text>
    </Box>
  );
};
