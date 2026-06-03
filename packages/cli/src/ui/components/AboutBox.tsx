/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';

interface AboutBoxProps {
  cliVersion: string;
  osVersion: string;
  sandboxEnv: string;
  modelVersion: string;
  gcpProject: string;
  keyfile: string;
  key: string;
  ideClient: string;
  provider: string;
  baseURL: string;
}

interface InfoRowProps {
  label: string;
  value: string;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value }) => (
  <Box flexDirection="row">
    <Box width="35%">
      <Text bold color={Colors.LightBlue}>
        {label}
      </Text>
    </Box>
    <Box>
      <Text color={Colors.Foreground}>{value}</Text>
    </Box>
  </Box>
);

interface ConditionalInfoRowProps {
  label: string;
  value: string | undefined;
}

const ConditionalInfoRow: React.FC<ConditionalInfoRowProps> = ({
  label,
  value,
}) => {
  if (!value) {
    return null;
  }
  return <InfoRow label={label} value={value} />;
};

const AboutBoxHeader: React.FC = () => (
  <Box marginBottom={1}>
    <Text bold color={Colors.AccentPurple}>
      About LLxprt Code
    </Text>
  </Box>
);

const AboutBoxContent: React.FC<{
  cliVersion: string;
  modelVersion: string;
  provider: string;
  sandboxEnv: string;
  osVersion: string;
  gcpProject: string;
  baseURL: string;
  ideClient: string;
}> = ({
  cliVersion,
  modelVersion,
  provider,
  sandboxEnv,
  osVersion,
  gcpProject,
  baseURL,
  ideClient,
}) => (
  <>
    <AboutBoxHeader />
    <InfoRow label="CLI Version" value={cliVersion} />
    {!['', 'N/A'].includes(GIT_COMMIT_INFO) && (
      <InfoRow label="Git Commit" value={GIT_COMMIT_INFO} />
    )}
    <InfoRow label="Model" value={modelVersion} />
    <InfoRow label="Provider" value={provider} />
    <ConditionalInfoRow label="Base URL" value={baseURL} />
    <InfoRow label="Sandbox" value={sandboxEnv} />
    <InfoRow label="OS" value={osVersion} />
    <ConditionalInfoRow label="GCP Project" value={gcpProject} />
    <ConditionalInfoRow label="IDE Client" value={ideClient} />
  </>
);

export const AboutBox: React.FC<AboutBoxProps> = ({
  cliVersion,
  osVersion,
  sandboxEnv,
  modelVersion,
  gcpProject,
  ideClient,
  provider,
  baseURL,
}) => (
  <Box
    borderStyle="round"
    borderColor={Colors.Gray}
    flexDirection="column"
    padding={1}
    marginY={1}
    width="100%"
    backgroundColor={Colors.Background}
  >
    <AboutBoxContent
      cliVersion={cliVersion}
      modelVersion={modelVersion}
      provider={provider}
      sandboxEnv={sandboxEnv}
      osVersion={osVersion}
      gcpProject={gcpProject}
      baseURL={baseURL}
      ideClient={ideClient}
    />
  </Box>
);
