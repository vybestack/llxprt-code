/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OAuth Code Input Dialog Component
 *
 * Allows users to paste authorization code from browser
 */

import type React from 'react';
import { useState, useCallback, useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';
import type { OAuthUIBridge } from '@vybestack/llxprt-code-auth';
import { Colors } from '../colors.js';
import type { Key } from '../hooks/useKeypress.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

interface OAuthCodeDialogProps {
  provider: string;
  /** The owning root's dialog state; each root has its own. */
  dialogState: Pick<
    OAuthUIBridge,
    'subscribeDialog' | 'getDialog' | 'dismissDialog'
  >;
  onClose: () => void;
  onSubmit: (code: string) => void;
}

function getInstructions(provider: string): string[] {
  if (provider === 'gemini') {
    return [
      'The OAuth URL has been copied to your clipboard.',
      'Please paste it into your browser to authenticate with Google.',
      'After authenticating, paste the verification code you receive below:',
    ];
  }
  return [
    'Please check your browser and authorize the application.',
    'After authorizing, paste the authorization code below:',
  ];
}

/**
 * The sequence already has the paste content without escape codes; keep only
 * valid OAuth code characters. Slash is allowed because Google auth codes often
 * contain it (e.g., 4/XXXX...).
 */
function cleanPastedCode(sequence: string): string {
  return sequence.replace(/[^a-zA-Z0-9/_#-]/g, '');
}

interface OAuthCodeViewProps {
  provider: string;
  error: string | undefined;
  code: string;
  waiting: boolean;
}

const OAuthCodeView: React.FC<OAuthCodeViewProps> = ({
  provider,
  error,
  code,
  waiting,
}) => (
  <Box
    flexDirection="column"
    borderStyle={getBorderStyle('round')}
    borderColor={Colors.AccentCyan}
    paddingX={2}
    paddingY={1}
    marginX={2}
    marginY={1}
  >
    <Text bold color={Colors.AccentCyan}>
      {provider.charAt(0).toUpperCase() + provider.slice(1)} OAuth
      Authentication
    </Text>
    {getInstructions(provider).map((instruction, index) => (
      <Text key={index} color={Colors.Foreground}>
        {instruction}
      </Text>
    ))}
    {error && <Text color={Colors.AccentRed}>{error}</Text>}
    <Box marginTop={1}>
      <Text color={Colors.AccentCyan}>Code: </Text>
      <Text color={Colors.Foreground}>
        {waiting
          ? 'Waiting for authentication to finish...'
          : code || '(paste only - typing disabled)'}
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.DimComment}>
        Paste code • Enter to submit • Escape to cancel • Ctrl+L to clear
      </Text>
    </Box>
  </Box>
);

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P09
 * @requirement REQ-002.1
 * @pseudocode lines 38-45
 */
export const OAuthCodeDialog: React.FC<OAuthCodeDialogProps> = ({
  provider,
  dialogState,
  onClose,
  onSubmit,
}) => {
  const [code, setCode] = useState('');
  const [submittedAttemptId, setSubmittedAttemptId] = useState<string>();

  const attempt = useSyncExternalStore(dialogState.subscribeDialog, () =>
    dialogState.getDialog(),
  );
  const attemptId = attempt?.provider === provider ? attempt.id : '';
  const submitted = submittedAttemptId === attemptId;
  const error = attempt?.provider === provider ? attempt.error : undefined;

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P09
   * @requirement REQ-002.2, REQ-006.3
   * @pseudocode lines 46-65
   */
  const handleInput = useCallback(
    (key: Key) => {
      // Handle escape to close
      if (key.name === 'escape') {
        if (attempt?.provider === provider)
          dialogState.dismissDialog(attempt.id);
        onClose();
        return;
      }

      if (submitted) return;

      // Handle enter to submit
      if (key.name === 'return') {
        if (code.trim()) {
          onSubmit(code.trim());
          if (provider === 'claudecode') setSubmittedAttemptId(attemptId);
          else onClose();
        }
        return;
      }

      // Handle clear (allow clearing the field with Cmd+K or Ctrl+L)
      if ((key.ctrl && key.name === 'l') || (key.meta && key.name === 'k')) {
        setCode('');
        return;
      }

      // ONLY accept pasted input - ignore ALL typed characters. A paste
      // replaces the entire code (it does not append).
      if (key.name === 'paste' && key.sequence) {
        const cleanInput = cleanPastedCode(key.sequence);
        if (cleanInput) setCode(cleanInput);
      }

      // Explicitly ignore ALL other input including:
      // - Regular typed characters
      // - Control codes
      // - Backspace (users must paste the entire correct code)
      // This prevents accidental control codes like I, IO, etc. from being added
    },
    [
      attempt,
      attemptId,
      code,
      dialogState,
      onClose,
      onSubmit,
      provider,
      submitted,
    ],
  );

  useKeypress(handleInput, { isActive: true });

  return (
    <OAuthCodeView
      provider={provider}
      error={error}
      code={code}
      waiting={submitted && !error}
    />
  );
};
