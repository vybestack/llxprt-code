/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors, SemanticColors } from '../../colors.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';
import {
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolEditConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolMcpConfirmationDetails,
  Config,
  MessageBusType,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from '../shared/RadioButtonSelect.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { useResponsive } from '../../hooks/useResponsive.js';
import { truncateEnd } from '../../utils/responsive.js';
import { useKeypress } from '../../hooks/useKeypress.js';

export interface ToolConfirmationMessageProps {
  confirmationDetails: ToolCallConfirmationDetails;
  config: Config;
  isFocused?: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const confirmationLogger = new DebugLogger('llxprt:ui:selection');

export const ToolConfirmationMessage: React.FC<
  ToolConfirmationMessageProps
> = ({
  confirmationDetails,
  config,
  isFocused = true,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const childWidth = terminalWidth - 2; // 2 for padding
  const { breakpoint } = useResponsive();

  // State to track whether details are shown
  const [showDetails, setShowDetails] = useState(false);

  const handleConfirm = useCallback(
    (outcome: ToolConfirmationOutcome) => {
      if (confirmationLogger.enabled) {
        confirmationLogger.debug(
          () =>
            `ToolConfirmationMessage handleConfirm outcome=${outcome} correlationId=${confirmationDetails.correlationId}`,
        );
      }
      const correlationId = confirmationDetails.correlationId;
      if (!correlationId) {
        console.error(
          'Tool confirmation missing correlationId; falling back to direct confirmation callback.',
        );
        void confirmationDetails.onConfirm(outcome);
        return;
      }

      const messageBus = config.getMessageBus();

      messageBus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId,
        outcome,
        confirmed:
          outcome !== ToolConfirmationOutcome.Cancel &&
          outcome !== ToolConfirmationOutcome.ModifyWithEditor,
        requiresUserConfirmation: false,
      });

      // Handle IDE operations asynchronously without blocking
      if (confirmationDetails.type === 'edit') {
        const ideClient = config.getIdeClient();
        if (config.getIdeMode()) {
          const cliOutcome =
            outcome === ToolConfirmationOutcome.Cancel
              ? 'rejected'
              : 'accepted';
          // Fire and forget with error handling to ensure it never blocks
          setTimeout(() => {
            ideClient
              ?.resolveDiffFromCli(confirmationDetails.filePath, cliOutcome)
              .catch((err) => {
                console.error('Failed to resolve IDE diff:', err);
              });
          }, 0);
        }
      }
    },
    [confirmationDetails, config],
  );

  const isTrustedFolder = config.isTrustedFolder();

  useKeypress(
    (key) => {
      if (!isFocused) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        handleConfirm(ToolConfirmationOutcome.Cancel);
      }
      // Handle 'd' key for details toggle
      if (key.name === 'd') {
        setShowDetails(!showDetails);
      }
    },
    { isActive: isFocused },
  );

  const handleSelect = useCallback(
    (item: ToolConfirmationOutcome) => handleConfirm(item),
    [handleConfirm],
  );

  // Helper function to determine if we should show details toggle
  const shouldShowDetailsToggle = (type: string): boolean => {
    if (type === 'edit') return false; // Edit diffs always show full content

    // For exec commands, show toggle if command is long
    if (type === 'exec') {
      const execDetails = confirmationDetails as ToolExecuteConfirmationDetails;
      return execDetails.command.length > 50;
    }

    // For info commands, show toggle if there are multiple URLs or long prompt
    if (type === 'info') {
      const infoDetails = confirmationDetails as {
        urls?: string[];
        prompt?: string;
      };
      const hasMultipleUrls = infoDetails.urls && infoDetails.urls.length > 2;
      const hasLongPrompt =
        infoDetails.prompt && infoDetails.prompt.length > 80;
      return Boolean(hasMultipleUrls || hasLongPrompt);
    }

    // For MCP commands, always allow details toggle
    return true;
  };

  // Helper function to create summary content
  const createSummary = (type: string): string => {
    if (type === 'exec') {
      const execDetails = confirmationDetails as ToolExecuteConfirmationDetails;
      return `Execute: ${execDetails.rootCommand}`;
    }

    if (type === 'info') {
      const infoDetails = confirmationDetails as { prompt?: string };
      return truncateEnd(infoDetails.prompt || 'Web fetch operation', 60);
    }

    if (type === 'mcp') {
      const mcpDetails = confirmationDetails as ToolMcpConfirmationDetails;
      return `MCP Tool: ${mcpDetails.toolName} from ${mcpDetails.serverName}`;
    }

    return 'Operation details';
  };

  let bodyContent: React.ReactNode | null = null;
  let question: string;

  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = new Array<
    RadioSelectItem<ToolConfirmationOutcome>
  >();

  const enableDetailsToggle = shouldShowDetailsToggle(confirmationDetails.type);

  // Different detail levels based on width
  const shouldShowSummary =
    enableDetailsToggle && !showDetails && breakpoint === 'NARROW';
  const shouldShowPartialDetails =
    enableDetailsToggle &&
    !showDetails &&
    (breakpoint === 'STANDARD' || breakpoint === 'WIDE');

  // Body content is now the DiffRenderer, passing filename to it
  // The bordered box is removed from here and handled within DiffRenderer

  function availableBodyContentHeight() {
    if (options.length === 0) {
      // This should not happen in practice as options are always added before this is called.
      throw new Error('Options not provided for confirmation message');
    }

    if (availableTerminalHeight === undefined) {
      return undefined;
    }

    // Calculate the vertical space (in lines) consumed by UI elements
    // surrounding the main body content.
    const PADDING_OUTER_Y = 2; // Main container has `padding={1}` (top & bottom).
    const MARGIN_BODY_BOTTOM = 1; // margin on the body container.
    const HEIGHT_QUESTION = 1; // The question text is one line.
    const MARGIN_QUESTION_BOTTOM = 1; // Margin on the question container.
    const HEIGHT_OPTIONS = options.length; // Each option in the radio select takes one line.

    const surroundingElementsHeight =
      PADDING_OUTER_Y +
      MARGIN_BODY_BOTTOM +
      HEIGHT_QUESTION +
      MARGIN_QUESTION_BOTTOM +
      HEIGHT_OPTIONS;
    return Math.max(availableTerminalHeight - surroundingElementsHeight, 1);
  }

  if (confirmationDetails.type === 'edit') {
    if (confirmationDetails.isModifying) {
      return (
        <Box
          minWidth="90%"
          borderStyle="round"
          borderColor={Colors.Gray}
          justifyContent="space-around"
          padding={1}
          overflow="hidden"
        >
          <Text color={Colors.Foreground}>Modify in progress: </Text>
          <Text color={Colors.AccentGreen}>
            Save and close external editor to continue
          </Text>
        </Box>
      );
    }

    question = `Apply this change?`;
    options.push({
      label: 'Yes, allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Yes, allow once',
    });
    if (isTrustedFolder) {
      options.push({
        label: 'Yes, allow always',
        value: ToolConfirmationOutcome.ProceedAlways,
        key: 'Yes, allow always',
      });
    }
    if (config.getIdeMode()) {
      options.push({
        label: 'No (esc)',
        value: ToolConfirmationOutcome.Cancel,
        key: 'No (esc)',
      });
    } else {
      options.push({
        label: 'Modify with external editor',
        value: ToolConfirmationOutcome.ModifyWithEditor,
        key: 'Modify with external editor',
      });
      options.push({
        label: 'No, suggest changes (esc)',
        value: ToolConfirmationOutcome.Cancel,
        key: 'No, suggest changes (esc)',
      });
    }
    const editDetails = confirmationDetails as ToolEditConfirmationDetails;
    const metadata = editDetails.metadata;
    const astValidation = metadata?.astValidation as
      | { valid: boolean; errors: string[] }
      | undefined;

    bodyContent = (
      <Box flexDirection="column">
        <Box marginBottom={1} paddingX={1} flexDirection="column">
          {astValidation && (
            <Box>
              {astValidation.valid ? (
                <Text color={Colors.AccentGreen}>✦ AST Validation Passed</Text>
              ) : (
                <Box flexDirection="column">
                  <Text color={Colors.AccentRed} bold>
                    ⚠ AST Validation Failed
                  </Text>
                  {(astValidation.errors as string[]).map(
                    (err: string, i: number) => (
                      <Text key={i} color={Colors.AccentRed}>
                        - {err}
                      </Text>
                    ),
                  )}
                </Box>
              )}
            </Box>
          )}
          {Boolean(metadata?.fileFreshness) && (
            <Box>
              <Text color={Colors.AccentGreen}>✦ File Freshness Verified</Text>
            </Box>
          )}
        </Box>
        <DiffRenderer
          diffContent={confirmationDetails.fileDiff}
          filename={confirmationDetails.fileName}
          availableTerminalHeight={availableBodyContentHeight()}
          terminalWidth={childWidth}
        />
      </Box>
    );
  } else if (confirmationDetails.type === 'exec') {
    const executionProps =
      confirmationDetails as ToolExecuteConfirmationDetails;

    question = `Allow execution of: '${executionProps.rootCommand}'?`;
    options.push({
      label: 'Yes, allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Yes, allow once',
    });
    if (isTrustedFolder) {
      options.push({
        label: `Yes, allow always ...`,
        value: ToolConfirmationOutcome.ProceedAlways,
        key: `Yes, allow always ...`,
      });
    }
    options.push({
      label: 'No, suggest changes (esc)',
      value: ToolConfirmationOutcome.Cancel,
      key: 'No, suggest changes (esc)',
    });

    let bodyContentHeight = availableBodyContentHeight();
    if (bodyContentHeight !== undefined) {
      bodyContentHeight -= 2; // Account for padding;
    }

    if (shouldShowSummary) {
      // Show summary with details toggle
      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          <Text color={SemanticColors.text.primary}>
            {createSummary('exec')}
          </Text>
          <Text color={Colors.DimComment}>
            Press &apos;d&apos; to see full details
          </Text>
        </Box>
      );
    } else if (shouldShowPartialDetails) {
      // Show partial details with toggle for full details (at wide width)
      const commandPreview =
        executionProps.command.length > 50
          ? executionProps.command.substring(0, 50) + '...'
          : executionProps.command;

      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          <Text color={Colors.AccentCyan}>{commandPreview}</Text>
          <Text color={Colors.DimComment}>
            Press &apos;d&apos; to see full details
          </Text>
        </Box>
      );
    } else {
      // Show full details
      bodyContent = (
        <Box flexDirection="column">
          {enableDetailsToggle && showDetails && (
            <Box paddingX={1} marginLeft={1} marginBottom={1}>
              <Text color={SemanticColors.text.secondary}>
                Full Parameters:
              </Text>
            </Box>
          )}
          <Box paddingX={1} marginLeft={1}>
            <MaxSizedBox
              maxHeight={bodyContentHeight}
              maxWidth={Math.max(childWidth - 4, 1)}
            >
              <Box>
                <Text color={Colors.AccentCyan}>{executionProps.command}</Text>
              </Box>
            </MaxSizedBox>
          </Box>
        </Box>
      );
    }
  } else if (confirmationDetails.type === 'info') {
    const infoProps = confirmationDetails;
    const displayUrls =
      infoProps.urls &&
      !(infoProps.urls.length === 1 && infoProps.urls[0] === infoProps.prompt);

    question = `Do you want to proceed?`;
    options.push({
      label: 'Yes, allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Yes, allow once',
    });
    if (isTrustedFolder) {
      options.push({
        label: 'Yes, allow always',
        value: ToolConfirmationOutcome.ProceedAlways,
        key: 'Yes, allow always',
      });
    }
    options.push({
      label: 'No, suggest changes (esc)',
      value: ToolConfirmationOutcome.Cancel,
      key: 'No, suggest changes (esc)',
    });

    if (shouldShowSummary) {
      // Show summary with details toggle
      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          <Text color={SemanticColors.text.primary}>
            {createSummary('info')}
          </Text>
          <Text color={Colors.DimComment}>
            Press &apos;d&apos; to see full details
          </Text>
        </Box>
      );
    } else {
      // Show full details
      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          {enableDetailsToggle && showDetails && (
            <Box marginBottom={1}>
              <Text color={SemanticColors.text.secondary}>
                Full Parameters:
              </Text>
            </Box>
          )}
          <Text color={Colors.AccentCyan}>
            <RenderInline text={infoProps.prompt} />
          </Text>
          {displayUrls && infoProps.urls && infoProps.urls.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={Colors.Foreground}>URLs to fetch:</Text>
              {infoProps.urls.map((url: string) => (
                <Text key={url} color={Colors.Foreground}>
                  {' '}
                  - <RenderInline text={url} />
                </Text>
              ))}
            </Box>
          )}
        </Box>
      );
    }
  } else {
    // mcp tool confirmation
    const mcpProps = confirmationDetails as ToolMcpConfirmationDetails;

    if (shouldShowSummary) {
      // Show summary with details toggle
      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          <Text color={SemanticColors.text.primary}>
            {createSummary('mcp')}
          </Text>
          <Text color={Colors.DimComment}>
            Press &apos;d&apos; to see full details
          </Text>
        </Box>
      );
    } else {
      // Show full details
      bodyContent = (
        <Box flexDirection="column" paddingX={1} marginLeft={1}>
          {enableDetailsToggle && showDetails && (
            <Box marginBottom={1}>
              <Text color={SemanticColors.text.secondary}>
                Full Parameters:
              </Text>
            </Box>
          )}
          <Text color={Colors.AccentCyan}>
            MCP Server: {mcpProps.serverName}
          </Text>
          <Text color={Colors.AccentCyan}>Tool: {mcpProps.toolName}</Text>
        </Box>
      );
    }

    question = `Allow execution of MCP tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"?`;
    options.push({
      label: 'Yes, allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Yes, allow once',
    });
    if (isTrustedFolder) {
      options.push({
        label: `Yes, always allow tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysTool, // Cast until types are updated
        key: `Yes, always allow tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"`,
      });
      options.push({
        label: `Yes, always allow all tools from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysServer,
        key: `Yes, always allow all tools from server "${mcpProps.serverName}"`,
      });
    }
    options.push({
      label: 'No, suggest changes (esc)',
      value: ToolConfirmationOutcome.Cancel,
      key: 'No, suggest changes (esc)',
    });
  }

  return (
    <Box flexDirection="column" padding={1} width={childWidth}>
      {/* Body Content (Diff Renderer or Command Info) */}
      {/* No separate context display here anymore for edits */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden" marginBottom={1}>
        {bodyContent}
      </Box>

      {/* Confirmation Question */}
      <Box marginBottom={1} flexShrink={0}>
        <Text wrap="truncate" color={SemanticColors.status.success}>
          {question}
        </Text>
      </Box>

      {/* Select Input for Options */}
      <Box flexShrink={0}>
        <RadioButtonSelect
          items={options}
          onSelect={handleSelect}
          isFocused={isFocused}
        />
      </Box>
    </Box>
  );
};
