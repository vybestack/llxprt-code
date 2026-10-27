/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3909: a failure of LLxprt's own token counting that reaches the CLI
 * must be shown as a local failure with its model, stage and cause detail,
 * not as a provider "[API Error: ...]". Real API failures keep their label.
 */

import { describe, expect, it, vi } from 'bun:test';
import { LocalTokenizationError } from '@vybestack/llxprt-code-core';
import { handleSubmissionError } from './streamUtils.js';
import { MessageType } from '../../types.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';
import { formatNonInteractiveError } from '../../../session/errorReporting.js';

const DETAIL =
  'Prompt estimator tokenization-failed for claude-opus-5 (anthropic-messages); verify the history entry; cause: encode exploded';

function displayedText(error: unknown): {
  text: string;
  authTriggered: boolean;
} {
  const addItem = vi.fn();
  const onAuthError = vi.fn();
  handleSubmissionError(
    error,
    addItem,
    createStreamRuntimeForTest({ getModel: vi.fn(() => 'test-model') }),
    onAuthError,
    Date.now(),
  );
  const item: { type: string; text: string } = addItem.mock.calls[0][0];
  expect(item.type).toBe(MessageType.ERROR);
  return { text: item.text, authTriggered: onAuthError.mock.calls.length > 0 };
}

describe('CLI display of local tokenization failures (issue #3909)', () => {
  it('shows a thrown local tokenization failure with its detail and no API error label', () => {
    const { text, authTriggered } = displayedText(
      new LocalTokenizationError(DETAIL),
    );

    expect(text).toContain(DETAIL);
    expect(text).toContain('Local Tokenization Error');
    expect(text).not.toContain('API Error');
    expect(authTriggered).toBe(false);
  });

  it('still shows an ordinary submission failure as an API error', () => {
    const { text } = displayedText(new Error('socket hang up'));

    expect(text).toBe('[API Error: socket hang up]');
  });

  it('shows a non-interactive stream error that carries the local category as a local failure', () => {
    const reconstructed = Object.assign(new Error(DETAIL), {
      category: 'local_tokenization',
    });

    const text = formatNonInteractiveError(reconstructed);

    expect(text).toContain(DETAIL);
    expect(text).toContain('Local Tokenization Error');
    expect(text).not.toContain('API Error');
  });
});
