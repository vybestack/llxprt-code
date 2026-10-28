/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { captureScreen, runTmux } from './tmux-harness-io.ts';

export type InputDiagnosticPhase =
  | 'before-step'
  | 'after-step'
  | 'before-type'
  | 'after-type'
  | 'before-key'
  | 'after-key'
  | 'failure';

export type ObserveInput = (
  phase: InputDiagnosticPhase,
  literal?: string,
  key?: string,
) => Promise<void>;

const fields = [
  'pane_in_mode',
  'pane_dead',
  'alternate_on',
  'cursor_flag',
  'keypad_flag',
  'insert_flag',
  'bracket_paste_flag',
  'pane_active',
  'pane_synchronized',
  'cursor_x',
  'cursor_y',
  'buffer_size',
];

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Records producer boundaries, not an acknowledgement that the UI consumed input. */
export async function recordInputDiagnostic(
  sessionName: string,
  outDir: string,
  stepIndex: number,
  phase: InputDiagnosticPhase,
  literal?: string,
  key?: string,
): Promise<void> {
  const screen = captureScreen(sessionName);
  const values = runTmux([
    'display-message',
    '-p',
    '-t',
    `${sessionName}:0.0`,
    fields.map((field) => `#{${field}}`).join('|'),
  ])
    .trim()
    .split('|');
  const tmux = Object.fromEntries(
    fields.map((field, index) => {
      const value = values[index] ?? '';
      return [field, /^\d+$/.test(value) ? value : null];
    }),
  );
  let diagnosticKey: string | undefined;
  if (key === undefined) {
    diagnosticKey = undefined;
  } else if (['Enter', 'Escape', 'C-d', '!'].includes(key)) {
    diagnosticKey = key;
  } else {
    diagnosticKey = 'other';
  }
  // Neither command bodies, terminal contents, clipboard contents nor environment
  // values belong in this trace. Unsupported tmux formats remain explicitly null.
  await appendFile(
    path.join(outDir, 'input-diagnostics.jsonl'),
    JSON.stringify({
      stepIndex,
      phase,
      observedAt: new Date().toISOString(),
      monotonicMs: performance.now(),
      tmux,
      shellModeVisible: screen.includes('shell mode enabled'),
      shellPromptVisible: screen.includes('Type your shell command'),
      messagePromptVisible: screen.includes('Type your message'),
      screenSha256: digest(screen),
      literal:
        literal === undefined
          ? undefined
          : {
              sha256: digest(literal),
              utf8Bytes: Buffer.byteLength(literal),
              carriageReturns: literal.split('\r').length - 1,
              lineFeeds: literal.split('\n').length - 1,
              visibleOnScreen: screen.includes(literal),
            },
      key: diagnosticKey,
    }) + '\n',
    'utf8',
  );
}
