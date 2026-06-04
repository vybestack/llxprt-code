/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text, useInput } from 'ink';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { performWorkspaceExtensionMigration } from '../../config/extension.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { Colors } from '../colors.js';
import { useState, useCallback } from 'react';

interface MigrationCompleteContentProps {
  failedExtensions: string[];
}

function MigrationCompleteContent({
  failedExtensions,
}: MigrationCompleteContentProps) {
  if (failedExtensions.length > 0) {
    return (
      <>
        <Text color={Colors.Foreground}>
          The following extensions failed to migrate. Please try installing them
          manually. To see other changes, LLxprt Code must be restarted. Press
          {"'q'"} to quit.
        </Text>
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {failedExtensions.map((failed) => (
            <Text key={failed} color={Colors.Foreground}>
              - {failed}
            </Text>
          ))}
        </Box>
      </>
    );
  }
  return (
    <Text color={Colors.Foreground}>
      Migration complete. To see changes, LLxprt Code must be restarted. Press
      {"'q'"} to quit.
    </Text>
  );
}

interface ExtensionListProps {
  workspaceExtensions: GeminiCLIExtension[];
}

function ExtensionList({ workspaceExtensions }: ExtensionListProps) {
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      {workspaceExtensions.map((extension) => (
        <Text key={extension.name} color={Colors.Foreground}>
          - {extension.name}
        </Text>
      ))}
    </Box>
  );
}

interface MigrationPromptProps {
  workspaceExtensions: GeminiCLIExtension[];
  onSelect: (value: string) => void;
}

function MigrationPrompt({
  workspaceExtensions,
  onSelect,
}: MigrationPromptProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.Gray}
      padding={1}
    >
      <Text bold color={Colors.Foreground}>
        Workspace-level extensions are deprecated{'\n'}
      </Text>
      <Text color={Colors.Foreground}>
        Would you like to install them at the user level?
      </Text>
      <Text color={Colors.Foreground}>
        The extension definition will remain in your workspace directory.
      </Text>
      <Text color={Colors.Foreground}>
        If you opt to skip, you can install them manually using the extensions
        install command.
      </Text>
      <ExtensionList workspaceExtensions={workspaceExtensions} />
      <Box marginTop={1}>
        <RadioButtonSelect
          items={[
            { label: 'Install all', value: 'migrate', key: 'migrate' },
            { label: 'Skip', value: 'skip', key: 'skip' },
          ]}
          onSelect={onSelect}
        />
      </Box>
    </Box>
  );
}

export function WorkspaceMigrationDialog(props: {
  workspaceExtensions: GeminiCLIExtension[];
  onOpen: () => void;
  onClose: () => void;
}) {
  const { workspaceExtensions, onOpen, onClose } = props;
  const [migrationComplete, setMigrationComplete] = useState(false);
  const [failedExtensions, setFailedExtensions] = useState<string[]>([]);
  onOpen();

  const onMigrate = useCallback(async () => {
    const failed = await performWorkspaceExtensionMigration(
      workspaceExtensions,
      async (_) => true,
    );
    setFailedExtensions(failed);
    setMigrationComplete(true);
  }, [workspaceExtensions]);

  const handleSelect = useCallback(
    (value: string) => {
      if (value === 'migrate') {
        void onMigrate();
      } else {
        onClose();
      }
    },
    [onMigrate, onClose],
  );

  useInput((input) => {
    if (migrationComplete && input === 'q') {
      process.exit(0);
    }
  });

  if (migrationComplete) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={Colors.Gray}
        padding={1}
      >
        <MigrationCompleteContent failedExtensions={failedExtensions} />
      </Box>
    );
  }

  return (
    <MigrationPrompt
      workspaceExtensions={workspaceExtensions}
      onSelect={handleSelect}
    />
  );
}
