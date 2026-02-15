import type {
  ScrollBoxRenderable,
  TextareaRenderable,
  TextareaAction,
} from '@vybestack/opentui-core';
import { parseColor, stringToStyledText } from '@vybestack/opentui-core';
import React, { type RefObject } from 'react';
import { useMemo } from 'react';
import type { CompletionSuggestion } from '../../features/completion';
import type { ThemeDefinition } from '../../features/theme';
import type { ToolStatus, ToolConfirmationType } from '../../types/events';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-core';
import type { StreamState } from '../../hooks/useChatStore';
import { HeaderBar } from './HeaderBar';
import { StatusBar } from './StatusBar';
import { SuggestionPanel } from './SuggestionPanel';
import { renderMessage, type MessageRole } from './messages';
import { DiffViewer } from './DiffViewer';

export type ToolApprovalOutcome =
  | 'allow_once'
  | 'allow_always'
  | 'suggest_edit'
  | 'cancel';

type Role = MessageRole;

interface ChatMessage {
  id: string;
  kind: 'message';
  role: Role;
  text: string;
}

interface ToolBlockLegacy {
  id: string;
  kind: 'tool';
  lines: string[];
  isBatch: boolean;
  scrollable?: boolean;
  maxHeight?: number;
  streaming?: boolean;
}

interface ToolCall {
  id: string;
  kind: 'toolcall';
  callId: string;
  name: string;
  params: Record<string, unknown>;
  status: ToolStatus;
  output?: string;
  errorMessage?: string;
  confirmation?: {
    confirmationType: ToolConfirmationType;
    question: string;
    preview: string;
    canAllowAlways: boolean;
    coreDetails?: ToolCallConfirmationDetails;
  };
}

/** Pending approval state passed from app to layout */
export interface PendingApprovalState {
  readonly callId: string;
  readonly selectedIndex: number;
  readonly selectedOutcome?: ToolApprovalOutcome;
  readonly editedCommand?: string;
}

type ToolBlock = ToolBlockLegacy | ToolCall;
type ChatEntry = ChatMessage | ToolBlock;

const MIN_INPUT_LINES = 1;
const MAX_INPUT_LINES = 10;
// Key bindings:
// - Return submits
// - Shift+Return sends linefeed (\n) which inserts newline
// - Option+Return (meta) inserts newline
// - Keypad enter (kpenter/kpplus) submits
const TEXTAREA_KEY_BINDINGS: {
  name: string;
  action: TextareaAction;
  meta?: boolean;
  shift?: boolean;
}[] = [
  { name: 'return', action: 'submit' },
  { name: 'return', meta: true, action: 'newline' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
  { name: 'kpenter', action: 'submit' },
  { name: 'kpplus', action: 'submit' },
];

export interface ChatLayoutProps {
  readonly headerText: string;
  readonly entries: ChatEntry[];
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly autoFollow: boolean;
  readonly textareaRef: RefObject<TextareaRenderable | null>;
  readonly inputLineCount: number;
  readonly enforceInputLineBounds: () => void;
  readonly handleSubmit: () => void;
  readonly statusLabel: string;
  readonly promptCount: number;
  readonly responderWordCount: number;
  readonly streamState: StreamState;
  readonly onScroll: (event: { type: string }) => void;
  readonly onMouseUp?: () => void;
  readonly suggestions: CompletionSuggestion[];
  readonly selectedSuggestion: number;
  readonly theme: ThemeDefinition;
  /** Pending approval state for inline tool approval */
  readonly pendingApproval?: PendingApprovalState;
  /** Callback when user selects an approval option */
  readonly onApprovalSelect?: (
    callId: string,
    outcome: ToolApprovalOutcome,
    editedCommand?: string,
  ) => void;
  /** Whether input is disabled (e.g., during approval) */
  readonly inputDisabled?: boolean;
}

interface ScrollbackProps {
  readonly entries: ChatEntry[];
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly autoFollow: boolean;
  readonly onScroll: (event: { type: string }) => void;
  readonly theme: ThemeDefinition;
  readonly pendingApproval?: PendingApprovalState;
  readonly onApprovalSelect?: (
    callId: string,
    outcome: ToolApprovalOutcome,
    editedCommand?: string,
  ) => void;
}

interface InputAreaProps {
  readonly textareaRef: RefObject<TextareaRenderable | null>;
  readonly containerHeight: number;
  readonly textareaHeight: number;
  readonly handleSubmit: () => void;
  readonly enforceInputLineBounds: () => void;
  readonly theme: ThemeDefinition;
  readonly disabled?: boolean;
}

export function renderChatMessage(
  message: ChatMessage,
  theme: ThemeDefinition,
): React.ReactNode {
  return renderMessage(message.role, message.id, message.text, theme);
}

/**
 * Get status indicator symbol and color for tool status
 */
function getStatusIndicator(
  status: ToolStatus,
  theme: ThemeDefinition,
): { symbol: string; color: string } {
  const successColor = theme.colors.accent.success ?? theme.colors.status.fg;
  const errorColor = theme.colors.accent.error ?? theme.colors.text.primary;
  const warningColor = theme.colors.accent.warning ?? theme.colors.status.fg;
  const pendingColor = theme.colors.status.muted ?? theme.colors.text.muted;

  switch (status) {
    case 'pending':
      return { symbol: '○', color: pendingColor };
    case 'executing':
      return { symbol: '◎', color: pendingColor };
    case 'complete':
      return { symbol: '✓', color: successColor };
    case 'error':
      return { symbol: '✗', color: errorColor };
    case 'confirming':
      return { symbol: '?', color: warningColor };
    case 'cancelled':
      return { symbol: '-', color: warningColor };
  }
}

/**
 * Format tool parameters for display
 */
function formatParams(params: Record<string, unknown> | string): string[] {
  // Handle case where params might be a JSON string
  let paramsObj: Record<string, unknown>;
  if (typeof params === 'string') {
    try {
      paramsObj = JSON.parse(params) as Record<string, unknown>;
    } catch {
      // If parsing fails, just display the string as-is
      const displayValue =
        params.length > 80 ? params.slice(0, 77) + '...' : params;
      return [`  ${displayValue}`];
    }
  } else {
    paramsObj = params;
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(paramsObj)) {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    // Truncate long values
    const displayValue =
      valueStr.length > 80 ? valueStr.slice(0, 77) + '...' : valueStr;
    lines.push(`  ${key}: ${displayValue}`);
  }
  return lines;
}

// Maximum height for tool output scrollbox before requiring scroll
const TOOL_OUTPUT_MAX_HEIGHT = 10;

/** Approval option labels */
const APPROVAL_OPTIONS: { label: string; outcome: ToolApprovalOutcome }[] = [
  { label: '[1] Yes, allow once', outcome: 'allow_once' },
  { label: '[2] Yes, allow always', outcome: 'allow_always' },
  { label: '[3] No, suggest changes', outcome: 'suggest_edit' },
  { label: '[4] No, cancel (esc)', outcome: 'cancel' },
];

interface InlineApprovalProps {
  readonly tool: ToolCall;
  readonly theme: ThemeDefinition;
  readonly selectedIndex: number;
  readonly selectedOutcome?: ToolApprovalOutcome;
  readonly editedCommand?: string;
  readonly onApprovalSelect?: (
    callId: string,
    outcome: ToolApprovalOutcome,
    editedCommand?: string,
  ) => void;
}

function renderInlineApproval({
  tool,
  theme,
  selectedIndex,
  selectedOutcome,
  editedCommand,
  onApprovalSelect,
}: InlineApprovalProps): React.ReactNode {
  const confirmation = tool.confirmation;
  if (!confirmation) {
    return <></>;
  }

  const coreDetails = confirmation.coreDetails;

  // Render diff for edit confirmations
  const renderPreview = (): React.ReactNode => {
    if (
      confirmation.confirmationType === 'edit' &&
      coreDetails?.type === 'edit'
    ) {
      return (
        <DiffViewer
          diffContent={coreDetails.fileDiff}
          filename={coreDetails.fileName}
          maxHeight={15}
          theme={theme}
        />
      );
    }

    if (
      confirmation.confirmationType === 'exec' &&
      coreDetails?.type === 'exec'
    ) {
      return (
        <box flexDirection="column" style={{ gap: 0 }}>
          <text fg={theme.colors.text.muted}>Command:</text>
          <text fg={theme.colors.accent.warning ?? theme.colors.text.primary}>
            {coreDetails.command}
          </text>
        </box>
      );
    }

    // Fallback: show raw preview
    const previewLines = confirmation.preview.split('\n').slice(0, 5);
    return (
      <box flexDirection="column" style={{ gap: 0 }}>
        {previewLines.map((line, idx) => (
          <text key={`preview-${idx}`} fg={theme.colors.text.tool}>
            {line}
          </text>
        ))}
      </box>
    );
  };

  // Build options (skip "allow always" if not available)
  const options = APPROVAL_OPTIONS.filter((option) => {
    if (option.outcome === 'allow_always') {
      return confirmation.canAllowAlways;
    }
    if (option.outcome === 'suggest_edit') {
      return confirmation.confirmationType === 'exec';
    }
    return true;
  });
  const selectedOption =
    selectedOutcome !== undefined
      ? options.find((option) => option.outcome === selectedOutcome)
      : options[selectedIndex];
  const selectedEditedCommand =
    editedCommand?.trim().length === 0 ? undefined : editedCommand?.trim();

  return (
    <box flexDirection="column" style={{ gap: 0, marginTop: 1 }}>
      <text fg={theme.colors.accent.warning ?? theme.colors.status.fg}>
        <b>{confirmation.question}</b>
      </text>
      {renderPreview()}
      <box flexDirection="column" style={{ gap: 0, marginTop: 1 }}>
        {options.map((opt, idx) => {
          const isSelected =
            selectedOption !== undefined
              ? selectedOption.outcome === opt.outcome
              : idx === selectedIndex;
          return (
            <text
              key={opt.outcome}
              fg={
                isSelected
                  ? theme.colors.selection.fg
                  : theme.colors.text.primary
              }
              bg={isSelected ? theme.colors.selection.bg : undefined}
              onMouse={() => {
                onApprovalSelect?.(tool.callId, opt.outcome, editedCommand);
              }}
            >
              {isSelected ? '► ' : '  '}
              {opt.label}
            </text>
          );
        })}
      </box>
      {confirmation.confirmationType === 'exec' &&
        selectedOption?.outcome === 'suggest_edit' && (
          <box flexDirection="column" style={{ gap: 0, marginTop: 1 }}>
            <text fg={theme.colors.text.muted}>Edited command:</text>
            <text
              fg={theme.colors.accent.warning ?? theme.colors.text.primary}
              bg={theme.colors.panel.bg}
            >
              {selectedEditedCommand ??
                (coreDetails?.type === 'exec'
                  ? coreDetails.command
                  : confirmation.preview)}
            </text>
            <text fg={theme.colors.text.muted}>
              Type to edit, Backspace to delete, Enter to apply
            </text>
          </box>
        )}
      <text fg={theme.colors.text.muted} style={{ marginTop: 1 }}>
        ↑/↓ to navigate, Enter to select, Esc to cancel
      </text>
    </box>
  );
}

/**
 * Render a ToolCall entry with status, params, and output in a scrollable container
 */
export function renderToolCall(
  tool: ToolCall,
  theme: ThemeDefinition,
  pendingApproval?: PendingApprovalState,
  onApprovalSelect?: (
    callId: string,
    outcome: ToolApprovalOutcome,
    editedCommand?: string,
  ) => void,
): React.ReactNode {
  const { symbol, color } = getStatusIndicator(tool.status, theme);
  const paramLines = formatParams(tool.params);

  // Build output lines
  const outputLines: string[] = [];
  if (tool.output) {
    outputLines.push(...tool.output.split('\n'));
  }
  if (tool.errorMessage) {
    outputLines.push(`Error: ${tool.errorMessage}`);
  }

  // Border always uses panel.border color
  const borderColor = theme.colors.panel.border;

  // Output needs scrollbox if it exceeds max height
  const outputNeedsScroll = outputLines.length > TOOL_OUTPUT_MAX_HEIGHT;

  // Check if this tool has pending approval
  const isPendingApproval =
    pendingApproval?.callId === tool.callId && tool.confirmation !== undefined;

  return (
    <box
      key={tool.id}
      border
      style={{
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        marginTop: 0,
        marginBottom: 0,
        width: '100%',
        flexDirection: 'column',
        gap: 0,
        borderStyle: 'rounded',
        borderColor: isPendingApproval
          ? (theme.colors.accent.warning ?? borderColor)
          : borderColor,
        backgroundColor: theme.colors.panel.bg,
        overflow: 'hidden',
      }}
    >
      {/* Header: status symbol + tool name - both use status color */}
      <box key={`${tool.id}-header`} flexDirection="row" style={{ gap: 0 }}>
        <text fg={color}>{symbol}</text>
        <text fg={color}> {tool.name}</text>
      </box>

      {/* Parameters */}
      {paramLines.map((line, idx) => (
        <text
          key={`${tool.id}-param-${idx}`}
          fg={theme.colors.text.muted}
          style={{ paddingLeft: 1 }}
        >
          {line}
        </text>
      ))}

      {/* Inline approval UI if this tool is pending approval */}
      {isPendingApproval &&
        renderInlineApproval({
          tool,
          theme,
          selectedIndex: pendingApproval.selectedIndex,
          selectedOutcome: pendingApproval.selectedOutcome,
          editedCommand: pendingApproval.editedCommand,
          onApprovalSelect,
        })}

      {/* Output (shown after execution) - in scrollbox if large */}
      {outputLines.length > 0 && (
        <box
          key={`${tool.id}-output`}
          flexDirection="column"
          style={{ gap: 0 }}
        >
          <text fg={theme.colors.text.muted} style={{ paddingLeft: 1 }}>
            Output:
          </text>
          {outputNeedsScroll ? (
            <scrollbox
              style={{
                height: TOOL_OUTPUT_MAX_HEIGHT,
                maxHeight: TOOL_OUTPUT_MAX_HEIGHT,
                paddingLeft: 0,
                paddingRight: 0,
                paddingTop: 0,
                paddingBottom: 0,
                overflow: 'hidden',
              }}
              contentOptions={{ paddingLeft: 1, paddingRight: 0 }}
              scrollY
              scrollX={false}
            >
              <box flexDirection="column" style={{ gap: 0, width: '100%' }}>
                {outputLines.map((line, idx) => (
                  <text
                    key={`${tool.id}-output-${idx}`}
                    fg={
                      tool.errorMessage
                        ? (theme.colors.accent.error ??
                          theme.colors.text.primary)
                        : theme.colors.text.tool
                    }
                  >
                    {line}
                  </text>
                ))}
              </box>
            </scrollbox>
          ) : (
            outputLines.map((line, idx) => (
              <text
                key={`${tool.id}-output-${idx}`}
                fg={
                  tool.errorMessage
                    ? (theme.colors.accent.error ?? theme.colors.text.primary)
                    : theme.colors.text.tool
                }
                style={{ paddingLeft: 1 }}
              >
                {line}
              </text>
            ))
          )}
        </box>
      )}

      {/* Executing indicator */}
      {tool.status === 'executing' && (
        <text
          key={`${tool.id}-executing`}
          fg={theme.colors.text.muted}
          style={{ paddingLeft: 1 }}
        >
          ...executing...
        </text>
      )}
    </box>
  );
}

export function renderToolBlock(
  block: ToolBlockLegacy,
  theme: ThemeDefinition,
): React.ReactNode {
  const content =
    block.scrollable === true ? (
      <scrollbox
        style={{
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
          height: Math.min(
            block.lines.length + 1,
            block.maxHeight ?? block.lines.length + 1,
          ),
          maxHeight: block.maxHeight,
          overflow: 'hidden',
        }}
        contentOptions={{ paddingLeft: 0, paddingRight: 0 }}
        scrollY
        scrollX={false}
      >
        <box
          flexDirection="column"
          style={{ gap: 0, width: '100%', paddingLeft: 0, paddingRight: 0 }}
        >
          {block.lines.map((line, index) => (
            <text key={`${block.id}-line-${index}`} fg={theme.colors.text.tool}>
              {line}
            </text>
          ))}
        </box>
      </scrollbox>
    ) : (
      block.lines.map((line, index) => (
        <text key={`${block.id}-line-${index}`} fg={theme.colors.text.tool}>
          {line}
        </text>
      ))
    );

  return (
    <box
      key={block.id}
      border
      style={{
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        marginTop: 0,
        marginBottom: 0,
        width: '100%',
        flexDirection: 'column',
        gap: 0,
        borderStyle: block.isBatch ? 'rounded' : 'single',
        borderColor: theme.colors.panel.border,
        backgroundColor: theme.colors.panel.bg,
        overflow: 'hidden',
      }}
    >
      {content}
      {block.streaming === true ? (
        <text fg={theme.colors.text.muted} key={`${block.id}-streaming`}>
          ...streaming...
        </text>
      ) : null}
    </box>
  );
}

function ScrollbackView(props: ScrollbackProps): React.ReactNode {
  return (
    <scrollbox
      ref={props.scrollRef}
      style={{
        flexGrow: 1,
        border: true,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        overflow: 'hidden',
        borderColor: props.theme.colors.panel.border,
        backgroundColor: props.theme.colors.panel.bg,
      }}
      contentOptions={{ paddingLeft: 2, paddingRight: 2 }}
      verticalScrollbarOptions={{
        trackOptions: {
          backgroundColor: props.theme.colors.scrollbar?.track,
          foregroundColor: props.theme.colors.scrollbar?.thumb,
        },
      }}
      scrollX={false}
      stickyScroll={props.autoFollow}
      stickyStart="bottom"
      scrollY
      onMouse={props.onScroll}
      focused
    >
      <box flexDirection="column" style={{ gap: 0, width: '100%' }}>
        {props.entries.map((entry) => {
          if (entry.kind === 'message') {
            return renderChatMessage(entry, props.theme);
          }
          if (entry.kind === 'toolcall') {
            return renderToolCall(
              entry,
              props.theme,
              props.pendingApproval,
              props.onApprovalSelect,
            );
          }
          // Legacy tool block
          return renderToolBlock(entry, props.theme);
        })}
      </box>
    </scrollbox>
  );
}

function InputArea(props: InputAreaProps): React.ReactNode {
  const isDisabled = props.disabled === true;
  const placeholderText = useMemo(() => {
    const text = isDisabled
      ? 'Waiting for tool approval...'
      : 'Type a thought, then submit with Enter';
    const base = stringToStyledText(text);
    const fg = parseColor(props.theme.colors.input.placeholder);
    return { ...base, chunks: base.chunks.map((chunk) => ({ ...chunk, fg })) };
  }, [props.theme.colors.input.placeholder, isDisabled]);

  // When disabled, dim the colors to show input is inactive
  const inputFg = isDisabled
    ? props.theme.colors.text.muted
    : props.theme.colors.input.fg;
  const inputBg = isDisabled
    ? props.theme.colors.panel.bg
    : props.theme.colors.input.bg;

  return (
    <box
      style={{
        height: props.containerHeight,
        minHeight: MIN_INPUT_LINES + 2,
        maxHeight: MAX_INPUT_LINES + 2,
        border: true,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        flexDirection: 'column',
        gap: 0,
        borderColor: props.theme.colors.panel.border,
        backgroundColor: props.theme.colors.panel.bg,
      }}
    >
      <textarea
        ref={props.textareaRef}
        focused={!isDisabled}
        placeholder={placeholderText}
        keyBindings={TEXTAREA_KEY_BINDINGS}
        onSubmit={props.handleSubmit}
        onContentChange={props.enforceInputLineBounds}
        onCursorChange={props.enforceInputLineBounds}
        wrapMode="word"
        cursorColor={props.theme.colors.input.fg}
        style={{
          height: props.textareaHeight,
          minHeight: props.textareaHeight,
          maxHeight: props.textareaHeight,
          width: '100%',
        }}
        textColor={inputFg}
        focusedTextColor={inputFg}
        backgroundColor={inputBg}
        focusedBackgroundColor={inputBg}
      />
    </box>
  );
}

function clampInputLines(value: number): number {
  return Math.min(MAX_INPUT_LINES, Math.max(MIN_INPUT_LINES, value));
}

export function ChatLayout(props: ChatLayoutProps): React.ReactNode {
  const visibleInputLines = Math.min(
    MAX_INPUT_LINES,
    clampInputLines(props.inputLineCount),
  );
  const containerHeight = Math.min(
    MAX_INPUT_LINES + 2,
    Math.max(MIN_INPUT_LINES + 2, visibleInputLines + 2),
  );
  const textareaHeight = Math.max(3, containerHeight - 2);

  return (
    <box
      flexDirection="column"
      style={{
        width: '100%',
        height: '100%',
        padding: 1,
        gap: 1,
        backgroundColor: props.theme.colors.background,
      }}
      onMouseUp={props.onMouseUp}
    >
      <HeaderBar text={props.headerText} theme={props.theme} />
      <ScrollbackView
        entries={props.entries}
        scrollRef={props.scrollRef}
        autoFollow={props.autoFollow}
        onScroll={props.onScroll}
        theme={props.theme}
        pendingApproval={props.pendingApproval}
        onApprovalSelect={props.onApprovalSelect}
      />
      <InputArea
        textareaRef={props.textareaRef}
        containerHeight={containerHeight}
        textareaHeight={textareaHeight}
        handleSubmit={props.handleSubmit}
        enforceInputLineBounds={props.enforceInputLineBounds}
        theme={props.theme}
        disabled={props.inputDisabled}
      />
      <SuggestionPanel
        suggestions={props.suggestions}
        selectedIndex={props.selectedSuggestion}
        theme={props.theme}
      />
      <StatusBar
        statusLabel={props.statusLabel}
        promptCount={props.promptCount}
        responderWordCount={props.responderWordCount}
        streamState={props.streamState}
        theme={props.theme}
      />
    </box>
  );
}
