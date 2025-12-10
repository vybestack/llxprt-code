import type { JSX } from 'react';
import { useCallback, useMemo } from 'react';
import type { ThemeDefinition } from '../../features/theme';
import type { ToolConfirmationType } from '../../types/events';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-core';
import { ModalShell } from './ModalShell';
import { RadioSelect, type RadioSelectOption } from '../components/RadioSelect';
import { DiffViewer } from '../components/DiffViewer';

export type ToolApprovalOutcome = 'allow_once' | 'allow_always' | 'cancel';

export interface ToolApprovalDetails {
  readonly callId: string;
  readonly toolName: string;
  readonly confirmationType: ToolConfirmationType;
  readonly question: string;
  readonly preview: string;
  readonly params: Record<string, unknown>;
  readonly canAllowAlways: boolean;
  /** Full confirmation details from CoreToolScheduler (includes diff for edits) */
  readonly coreDetails?: ToolCallConfirmationDetails;
}

export interface ToolApprovalModalProps {
  readonly details: ToolApprovalDetails;
  readonly onDecision: (callId: string, outcome: ToolApprovalOutcome) => void;
  readonly onClose: () => void;
  readonly theme?: ThemeDefinition;
}

function getTypeIcon(type: ToolConfirmationType): string {
  switch (type) {
    case 'edit':
      return '✎';
    case 'exec':
      return '⚡';
    case 'mcp':
      return '⚙';
    case 'info':
      return 'ℹ';
    default:
      return '?';
  }
}

function getTypeLabel(type: ToolConfirmationType): string {
  switch (type) {
    case 'edit':
      return 'File Edit';
    case 'exec':
      return 'Shell Command';
    case 'mcp':
      return 'MCP Tool';
    case 'info':
      return 'Information Request';
    default:
      return 'Tool';
  }
}

interface PreviewContentProps {
  readonly details: ToolApprovalDetails;
  readonly theme?: ThemeDefinition;
}

/**
 * Render the preview content based on confirmation type
 */
function PreviewContent(props: PreviewContentProps): JSX.Element {
  const { details, theme } = props;

  // For edit confirmations with core details, show diff
  if (
    details.confirmationType === 'edit' &&
    details.coreDetails?.type === 'edit'
  ) {
    const editDetails = details.coreDetails;
    return (
      <DiffViewer
        diffContent={editDetails.fileDiff}
        filename={editDetails.fileName}
        maxHeight={15}
        {...(theme !== undefined ? { theme } : {})}
      />
    );
  }

  // For exec confirmations, show command
  if (
    details.confirmationType === 'exec' &&
    details.coreDetails?.type === 'exec'
  ) {
    const execDetails = details.coreDetails;
    return (
      <box
        border
        style={{
          padding: 1,
          borderColor: theme?.colors.panel.border,
          backgroundColor: theme?.colors.panel.bg,
          flexDirection: 'column',
          gap: 0,
        }}
      >
        <text fg={theme?.colors.text.muted}>Command:</text>
        <text fg={theme?.colors.accent.warning ?? theme?.colors.text.primary}>
          {execDetails.command}
        </text>
      </box>
    );
  }

  // For info confirmations (web fetch), show prompt and URLs
  if (
    details.confirmationType === 'info' &&
    details.coreDetails?.type === 'info'
  ) {
    const infoDetails = details.coreDetails;
    return (
      <box
        border
        style={{
          padding: 1,
          borderColor: theme?.colors.panel.border,
          backgroundColor: theme?.colors.panel.bg,
          flexDirection: 'column',
          gap: 0,
        }}
      >
        <text fg={theme?.colors.text.muted}>Prompt:</text>
        <text fg={theme?.colors.text.tool}>{infoDetails.prompt}</text>
        {infoDetails.urls && infoDetails.urls.length > 0 && (
          <>
            <text fg={theme?.colors.text.muted} style={{ marginTop: 1 }}>
              URLs:
            </text>
            {infoDetails.urls.map((url, index) => (
              <text key={`url-${index}`} fg={theme?.colors.accent.primary}>
                • {url}
              </text>
            ))}
          </>
        )}
      </box>
    );
  }

  // For MCP tool confirmations
  if (
    details.confirmationType === 'mcp' &&
    details.coreDetails?.type === 'mcp'
  ) {
    const mcpDetails = details.coreDetails;
    return (
      <box
        border
        style={{
          padding: 1,
          borderColor: theme?.colors.panel.border,
          backgroundColor: theme?.colors.panel.bg,
          flexDirection: 'column',
          gap: 0,
        }}
      >
        <text fg={theme?.colors.text.muted}>
          MCP Server: {mcpDetails.serverName}
        </text>
        <text fg={theme?.colors.text.muted}>
          Tool: {mcpDetails.toolDisplayName}
        </text>
      </box>
    );
  }

  // Fallback: show raw preview text
  const previewLines = details.preview.split('\n').slice(0, 20);
  return (
    <box
      border
      style={{
        padding: 1,
        borderColor: theme?.colors.panel.border,
        backgroundColor: theme?.colors.panel.bg,
        flexDirection: 'column',
        gap: 0,
        maxHeight: 15,
        overflow: 'hidden',
      }}
    >
      {previewLines.map((line, index) => (
        <text key={`preview-${index}`} fg={theme?.colors.text.tool}>
          {line}
        </text>
      ))}
    </box>
  );
}

export function ToolApprovalModal(props: ToolApprovalModalProps): JSX.Element {
  const { details, onDecision, onClose, theme } = props;

  const options = useMemo((): RadioSelectOption<ToolApprovalOutcome>[] => {
    const result: RadioSelectOption<ToolApprovalOutcome>[] = [
      { label: 'Yes, allow once', value: 'allow_once', key: 'allow_once' },
    ];

    if (details.canAllowAlways) {
      result.push({
        label: 'Yes, allow always',
        value: 'allow_always',
        key: 'allow_always',
      });
    }

    result.push({
      label: 'No, cancel (esc)',
      value: 'cancel',
      key: 'cancel',
    });

    return result;
  }, [details.canAllowAlways]);

  const handleSelect = useCallback(
    (outcome: ToolApprovalOutcome): void => {
      onDecision(details.callId, outcome);
      onClose();
    },
    [details.callId, onDecision, onClose],
  );

  const typeIcon = getTypeIcon(details.confirmationType);
  const typeLabel = getTypeLabel(details.confirmationType);

  // For edits, include filename in title
  let title = `${typeIcon} ${typeLabel}: ${details.toolName}`;
  if (
    details.confirmationType === 'edit' &&
    details.coreDetails?.type === 'edit'
  ) {
    title = `${typeIcon} ${typeLabel}: ${details.coreDetails.fileName}`;
  }

  const footer = (
    <text fg={theme?.colors.text.muted}>
      ↑/↓ to navigate, Enter to select, Esc to cancel
    </text>
  );

  return (
    <ModalShell
      title={title}
      subtitle={details.question}
      onClose={onClose}
      theme={theme}
      footer={footer}
      width="80%"
    >
      <box
        flexDirection="column"
        style={{
          gap: 1,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <PreviewContent details={details} theme={theme} />

        <box style={{ marginTop: 1 }}>
          <RadioSelect
            options={options}
            onSelect={handleSelect}
            theme={theme}
            isFocused={true}
          />
        </box>
      </box>
    </ModalShell>
  );
}
