/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useEffect, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';
import type {
  ToolCallConfirmationDetails,
  Config,
} from '@vybestack/llxprt-code-core';
import {
  IdeClient,
  ToolConfirmationOutcome,
  hasRedirection,
} from '@vybestack/llxprt-code-core';
import type { RadioSelectItem } from '../shared/RadioButtonSelect.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { MaxSizedBox, MINIMUM_MAX_HEIGHT } from '../shared/MaxSizedBox.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { theme } from '../../semantic-colors.js';
import { useAlternateBuffer } from '../../hooks/useAlternateBuffer.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import {
  REDIRECTION_WARNING_NOTE_LABEL,
  REDIRECTION_WARNING_NOTE_TEXT,
  REDIRECTION_WARNING_TIP_LABEL,
  REDIRECTION_WARNING_TIP_TEXT,
} from '../../textConstants.js';

/**
 * Build options for edit-type confirmation.
 */
function buildEditOptions(
  isTrustedFolder: boolean,
  allowPermanentApproval: boolean,
  config: Config,
  isDiffingEnabled: boolean | null,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [];

  options.push({
    label: 'Allow once',
    value: ToolConfirmationOutcome.ProceedOnce,
    key: 'Allow once',
  });

  if (isTrustedFolder) {
    options.push({
      label: 'Allow for this session',
      value: ToolConfirmationOutcome.ProceedAlways,
      key: 'Allow for this session',
    });
    if (allowPermanentApproval) {
      options.push({
        label: 'Allow for all future sessions',
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow for all future sessions',
      });
    }
  }

  if (!config.getIdeMode() || isDiffingEnabled === false) {
    options.push({
      label: 'Modify with external editor',
      value: ToolConfirmationOutcome.ModifyWithEditor,
      key: 'Modify with external editor',
    });
  }

  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });

  return options;
}

/**
 * Build options for exec/info-type confirmation.
 * Both exec and info types use the same option structure.
 */
function buildExecOptions(
  isTrustedFolder: boolean,
  allowPermanentApproval: boolean,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [];

  options.push({
    label: 'Allow once',
    value: ToolConfirmationOutcome.ProceedOnce,
    key: 'Allow once',
  });

  if (isTrustedFolder) {
    options.push({
      label: 'Allow for this session',
      value: ToolConfirmationOutcome.ProceedAlways,
      key: 'Allow for this session',
    });
    if (allowPermanentApproval) {
      options.push({
        label: 'Allow for all future sessions',
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow for all future sessions',
      });
    }
  }

  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });

  return options;
}

/**
 * Build options for info-type confirmation.
 */
function buildInfoOptions(
  isTrustedFolder: boolean,
  allowPermanentApproval: boolean,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  return buildExecOptions(isTrustedFolder, allowPermanentApproval);
}

/**
 * Build options for MCP tool confirmation.
 */
function buildMcpOptions(
  isTrustedFolder: boolean,
  allowPermanentApproval: boolean,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [];
  options.push({
    label: 'Allow once',
    value: ToolConfirmationOutcome.ProceedOnce,
    key: 'Allow once',
  });
  if (isTrustedFolder) {
    options.push({
      label: 'Allow tool for this session',
      value: ToolConfirmationOutcome.ProceedAlwaysTool,
      key: 'Allow tool for this session',
    });
    options.push({
      label: 'Allow all server tools for this session',
      value: ToolConfirmationOutcome.ProceedAlwaysServer,
      key: 'Allow all server tools for this session',
    });
    if (allowPermanentApproval) {
      options.push({
        label: 'Allow tool for all future sessions',
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow tool for all future sessions',
      });
    }
  }
  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });
  return options;
}

/**
 * Build question text and options for confirmation.
 */
function buildQuestionAndOptions(
  confirmationDetails: ToolCallConfirmationDetails,
  isTrustedFolder: boolean,
  allowPermanentApproval: boolean,
  config: Config,
  isDiffingEnabled: boolean | null,
): {
  question: string;
  options: Array<RadioSelectItem<ToolConfirmationOutcome>>;
} {
  if (confirmationDetails.type === 'edit') {
    if (confirmationDetails.isModifying !== true) {
      return {
        question: `Apply this change?`,
        options: buildEditOptions(
          isTrustedFolder,
          allowPermanentApproval,
          config,
          isDiffingEnabled,
        ),
      };
    }
    return { question: '', options: [] };
  }

  if (confirmationDetails.type === 'exec') {
    const execProps = confirmationDetails;
    const question =
      execProps.commands && execProps.commands.length > 1
        ? `Allow execution of ${execProps.commands.length} commands?`
        : `Allow execution of: '${execProps.rootCommand}'?`;
    return {
      question,
      options: buildExecOptions(isTrustedFolder, allowPermanentApproval),
    };
  }

  if (confirmationDetails.type === 'info') {
    return {
      question: `Do you want to proceed?`,
      options: buildInfoOptions(isTrustedFolder, allowPermanentApproval),
    };
  }

  const mcpProps = confirmationDetails;
  return {
    question: `Allow execution of MCP tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"?`,
    options: buildMcpOptions(isTrustedFolder, allowPermanentApproval),
  };
}

/**
 * Calculate available height for body content.
 */
function calculateAvailableBodyContentHeight(
  availableTerminalHeight: number | undefined,
  optionsLength: number,
): number | undefined {
  if (optionsLength === 0 || availableTerminalHeight === undefined) {
    return undefined;
  }

  const PADDING_OUTER_Y = 1;
  const MARGIN_BODY_BOTTOM = 1;
  const HEIGHT_QUESTION = 1;
  const MARGIN_QUESTION_BOTTOM = 1;
  const HEIGHT_OPTIONS = optionsLength;

  const surroundingElementsHeight =
    PADDING_OUTER_Y +
    MARGIN_BODY_BOTTOM +
    HEIGHT_QUESTION +
    MARGIN_QUESTION_BOTTOM +
    HEIGHT_OPTIONS;
  return Math.max(availableTerminalHeight - surroundingElementsHeight, 1);
}

/**
 * Build body content for exec confirmation.
 */
function buildExecBodyContent(
  executionProps: ToolCallConfirmationDetails & { type: 'exec' },
  terminalWidth: number,
  availableBodyContentHeight: number | undefined,
  isAlternateBuffer: boolean,
): React.ReactNode {
  const commandsToDisplay =
    executionProps.commands && executionProps.commands.length > 1
      ? executionProps.commands
      : [executionProps.command];
  const containsRedirection = commandsToDisplay.some((cmd) =>
    hasRedirection(cmd),
  );

  let bodyContentHeight = availableBodyContentHeight;
  let warnings: React.ReactNode = null;

  if (bodyContentHeight !== undefined) {
    bodyContentHeight -= 2;
  }

  if (containsRedirection) {
    const safeWidth = Math.max(terminalWidth, 1);
    const noteLength =
      REDIRECTION_WARNING_NOTE_LABEL.length +
      REDIRECTION_WARNING_NOTE_TEXT.length;
    const tipLength =
      REDIRECTION_WARNING_TIP_LABEL.length +
      REDIRECTION_WARNING_TIP_TEXT.length;

    const noteLines = Math.ceil(noteLength / safeWidth);
    const tipLines = Math.ceil(tipLength / safeWidth);
    const spacerLines = 1;
    const warningHeight = noteLines + tipLines + spacerLines;

    if (bodyContentHeight !== undefined) {
      bodyContentHeight = Math.max(
        bodyContentHeight - warningHeight,
        MINIMUM_MAX_HEIGHT,
      );
    }

    warnings = (
      <>
        <Box height={1} />
        <Text color={theme.text.primary}>
          <Text bold color={theme.text.primary}>
            {REDIRECTION_WARNING_NOTE_LABEL}
          </Text>
          {REDIRECTION_WARNING_NOTE_TEXT}
        </Text>
        <Text color={theme.border.default}>
          <Text bold color={theme.border.default}>
            {REDIRECTION_WARNING_TIP_LABEL}
          </Text>
          {REDIRECTION_WARNING_TIP_TEXT}
        </Text>
      </>
    );
  }

  const commandList = commandsToDisplay.join('\n');

  return (
    <Box flexDirection="column">
      {isAlternateBuffer ? (
        <Text color={theme.text.link}>{commandList}</Text>
      ) : (
        <MaxSizedBox
          maxHeight={bodyContentHeight}
          maxWidth={Math.max(terminalWidth, 1)}
        >
          <Box>
            <Text color={theme.text.link}>{commandList}</Text>
          </Box>
        </MaxSizedBox>
      )}
      {isAlternateBuffer ? (
        warnings
      ) : (
        <Box flexDirection="column">{warnings}</Box>
      )}
    </Box>
  );
}

/**
 * Build body content for info confirmation.
 */
function buildInfoBodyContent(
  infoProps: ToolCallConfirmationDetails & { type: 'info' },
): React.ReactNode {
  const displayUrls =
    infoProps.urls !== undefined &&
    infoProps.urls.length > 0 &&
    !(infoProps.urls.length === 1 && infoProps.urls[0] === infoProps.prompt);

  return (
    <Box flexDirection="column">
      <Text color={theme.text.link}>
        <RenderInline text={infoProps.prompt} defaultColor={theme.text.link} />
      </Text>
      {displayUrls && infoProps.urls !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.text.primary}>URLs to fetch:</Text>
          {infoProps.urls.map((url) => (
            <Text key={url} color={theme.text.primary}>
              {' '}
              - <RenderInline text={url} />
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Build body content based on confirmation type.
 */
function buildBodyContent(
  confirmationDetails: ToolCallConfirmationDetails,
  terminalWidth: number,
  availableBodyContentHeight: number | undefined,
  isAlternateBuffer: boolean,
): React.ReactNode | null {
  if (confirmationDetails.type === 'edit') {
    if (confirmationDetails.isModifying !== true) {
      return (
        <DiffRenderer
          diffContent={confirmationDetails.fileDiff}
          filename={confirmationDetails.fileName}
          availableTerminalHeight={availableBodyContentHeight}
          terminalWidth={terminalWidth}
        />
      );
    }
    return null;
  }

  if (confirmationDetails.type === 'exec') {
    return buildExecBodyContent(
      confirmationDetails,
      terminalWidth,
      availableBodyContentHeight,
      isAlternateBuffer,
    );
  }

  if (confirmationDetails.type === 'info') {
    return buildInfoBodyContent(confirmationDetails);
  }

  const mcpProps = confirmationDetails;
  return (
    <Box flexDirection="column">
      <Text color={theme.text.link}>MCP Server: {mcpProps.serverName}</Text>
      <Text color={theme.text.link}>Tool: {mcpProps.toolName}</Text>
    </Box>
  );
}

/**
 * Hook to manage IDE client state.
 */
function useIdeClientState(config: Config): {
  ideClient: IdeClient | null;
  isDiffingEnabled: boolean | null;
} {
  const [ideClient, setIdeClient] = useState<IdeClient | null>(null);
  const [isDiffingEnabled, setIsDiffingEnabled] = useState<boolean | null>(
    config.getIdeMode() ? null : false,
  );

  useEffect(() => {
    let isMounted = true;
    if (config.getIdeMode()) {
      const getIdeClient = async () => {
        const client = await IdeClient.getInstance();
        if (isMounted) {
          setIdeClient(client);
          setIsDiffingEnabled(client.isDiffingEnabled());
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getIdeClient();
    }
    return () => {
      isMounted = false;
    };
  }, [config]);

  return { ideClient, isDiffingEnabled };
}

/**
 * Hook to derive confirmation question, body content, and options.
 */
function useConfirmationContent(
  confirmationDetails: ToolCallConfirmationDetails,
  config: Config,
  isDiffingEnabled: boolean | null,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
): {
  question: string;
  bodyContent: React.ReactNode | null;
  options: Array<RadioSelectItem<ToolConfirmationOutcome>>;
} {
  const isTrustedFolder = config.isTrustedFolder();
  const isAlternateBuffer = useAlternateBuffer();
  const settings = useSettings();
  const allowPermanentApproval =
    settings.merged.security.enablePermanentToolApproval === true;

  return useMemo(() => {
    const { question, options } = buildQuestionAndOptions(
      confirmationDetails,
      isTrustedFolder,
      allowPermanentApproval,
      config,
      isDiffingEnabled,
    );

    const availableBodyContentHeight = calculateAvailableBodyContentHeight(
      availableTerminalHeight,
      options.length,
    );

    const bodyContent = buildBodyContent(
      confirmationDetails,
      terminalWidth,
      availableBodyContentHeight,
      isAlternateBuffer,
    );

    return { question, bodyContent, options };
  }, [
    confirmationDetails,
    isTrustedFolder,
    config,
    isDiffingEnabled,
    availableTerminalHeight,
    terminalWidth,
    isAlternateBuffer,
    allowPermanentApproval,
  ]);
}

/**
 * Create the keypress handler for confirmation cancellation.
 */
function useCancelKeypress(
  isFocused: boolean,
  handleConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>,
): void {
  useKeypress(
    (key) => {
      if (isFocused !== true) return;
      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        void handleConfirm(ToolConfirmationOutcome.Cancel);
      }
    },
    { isActive: isFocused },
  );
}

export interface ToolConfirmationMessageProps {
  confirmationDetails: ToolCallConfirmationDetails;
  config: Config;
  isFocused?: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

export const ToolConfirmationMessage: React.FC<
  ToolConfirmationMessageProps
> = ({
  confirmationDetails,
  config,
  isFocused = true,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const { onConfirm } = confirmationDetails;
  const { ideClient, isDiffingEnabled } = useIdeClientState(config);

  const handleConfirm = async (outcome: ToolConfirmationOutcome) => {
    if (
      confirmationDetails.type === 'edit' &&
      config.getIdeMode() &&
      isDiffingEnabled === true
    ) {
      const cliOutcome =
        outcome === ToolConfirmationOutcome.Cancel ? 'rejected' : 'accepted';
      await ideClient?.resolveDiffFromCli(
        confirmationDetails.filePath,
        cliOutcome,
      );
    }
    await onConfirm(outcome);
  };

  useCancelKeypress(isFocused, handleConfirm);

  const handleSelect = (item: ToolConfirmationOutcome) => {
    void handleConfirm(item);
  };

  const { question, bodyContent, options } = useConfirmationContent(
    confirmationDetails,
    config,
    isDiffingEnabled,
    availableTerminalHeight,
    terminalWidth,
  );

  if (
    confirmationDetails.type === 'edit' &&
    confirmationDetails.isModifying === true
  ) {
    return (
      <Box
        width={terminalWidth}
        borderStyle="round"
        borderColor={theme.border.default}
        justifyContent="space-around"
        paddingTop={1}
        paddingBottom={1}
        overflow="hidden"
      >
        <Text color={theme.text.primary}>Modify in progress: </Text>
        <Text color={theme.status.success}>
          Save and close external editor to continue
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={0} paddingBottom={1}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" marginBottom={1}>
        {bodyContent}
      </Box>
      <Box marginBottom={1} flexShrink={0}>
        <Text color={theme.text.primary}>{question}</Text>
      </Box>
      <Box flexShrink={0}>
        <RadioButtonSelect
          items={options}
          // eslint-disable-next-line react/jsx-no-bind
          onSelect={handleSelect}
          isFocused={isFocused}
        />
      </Box>
    </Box>
  );
};
