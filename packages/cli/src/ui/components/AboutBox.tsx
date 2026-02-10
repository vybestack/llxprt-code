/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
    <Box marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        About LLxprt Code
      </Text>
    </Box>
    <Box flexDirection="row">
      <Box width="35%">
        <Text bold color={Colors.LightBlue}>
          CLI Version
        </Text>
      </Box>
      <Box>
        <Text color={Colors.Foreground}>{cliVersion}</Text>
      </Box>
    </Box>
    {GIT_COMMIT_INFO && !['N/A'].includes(GIT_COMMIT_INFO) && (
      <Box flexDirection="row">
        <Box width="35%">
          <Text bold color={Colors.LightBlue}>
            Git Commit
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Foreground}>{GIT_COMMIT_INFO}</Text>
        </Box>
      </Box>
    )}
    <Box flexDirection="row">
      <Box width="35%">
        <Text bold color={Colors.LightBlue}>
          Model
        </Text>
      </Box>
      <Box>
        <Text color={Colors.Foreground}>{modelVersion}</Text>
      </Box>
    </Box>
    <Box flexDirection="row">
      <Box width="35%">
        <Text bold color={Colors.LightBlue}>
          Provider
        </Text>
      </Box>
      <Box>
        <Text color={Colors.Foreground}>{provider}</Text>
      </Box>
    </Box>
    {baseURL && (
      <Box flexDirection="row">
        <Box width="35%">
          <Text bold color={Colors.LightBlue}>
            Base URL
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Foreground}>{baseURL}</Text>
        </Box>
      </Box>
    )}
    <Box flexDirection="row">
      <Box width="35%">
        <Text bold color={Colors.LightBlue}>
          Sandbox
        </Text>
      </Box>
      <Box>
        <Text color={Colors.Foreground}>{sandboxEnv}</Text>
      </Box>
    </Box>
    <Box flexDirection="row">
      <Box width="35%">
        <Text bold color={Colors.LightBlue}>
          OS
        </Text>
      </Box>
      <Box>
        <Text color={Colors.Foreground}>{osVersion}</Text>
      </Box>
    </Box>
    {gcpProject && (
      <Box flexDirection="row">
        <Box width="35%">
          <Text bold color={Colors.LightBlue}>
            GCP Project
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Foreground}>{gcpProject}</Text>
        </Box>
      </Box>
    )}
    {ideClient && (
      <Box flexDirection="row">
        <Box width="35%">
          <Text bold color={Colors.LightBlue}>
            IDE Client
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Foreground}>{ideClient}</Text>
        </Box>
      </Box>
    )}
  </Box>
);
