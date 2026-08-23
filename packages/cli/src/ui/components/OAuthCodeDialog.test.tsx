/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'bun:test';
import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders, waitFor } from '../../test-utils/render.js';
import { act } from 'react';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';

const PLACEHOLDER = '(paste only - typing disabled)';

const paste = (
  stdin: { write: (data: string) => void },
  code: string,
): Promise<void> =>
  act(async () => {
    stdin.write(`\x1b[200~${code}\x1b[201~`);
  });

describe('OAuthCodeDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores typed characters, keeping the paste-only placeholder and no code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => {
      expect(stdout.lastFrame()).toContain(PLACEHOLDER);
    });
    await act(async () => {
      stdin.write('abc');
    });
    await waitFor(() => {
      const frame = stdout.lastFrame();
      expect(frame).toContain(PLACEHOLDER);
      expect(frame).not.toContain('abc');
    });

    // Typed input must never arm a submission: Return on the still-empty code
    // calls neither callback.
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('delivers content from a bracketed paste', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await paste(stdin, 'ABCd123');
    await waitFor(() => {
      const frame = stdout.lastFrame();
      expect(frame).toContain('ABCd123');
      expect(frame).not.toContain(PLACEHOLDER);
    });
    unmount();
  });

  it('closes on Escape: onClose once, onSubmit never', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    await act(async () => {
      await runAllTimersAsync();
    });

    // A lone ESC byte is only decoded as an "escape" key once the parser hits
    // its ESC_TIMEOUT flush, so the key arm must advance the clock past that.
    await act(async () => {
      stdin.write('\x1B');
    });
    await act(async () => {
      await runAllTimersAsync();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('submits the trimmed pasted code on Return, then closes', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await paste(stdin, '  4/Abcde  ');
    await waitFor(() => {
      expect(stdout.lastFrame()).toContain('4/Abcde');
    });

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('4/Abcde');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    unmount();
  });

  it('does nothing on Return with an empty code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('filters invalid characters out of a pasted code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await paste(stdin, '4/Ab!@#$%^&*()cde');
    await waitFor(() => {
      const frame = stdout.lastFrame();
      // Allowed set is [a-zA-Z0-9/_#-]: '#' is valid, so only
      // '!@$%^&*()' are stripped, leaving '4/Ab#cde'.
      expect(frame).toContain('4/Ab#cde');
      expect(frame).not.toContain('4/Ab!');
      expect(frame).not.toContain('@$%^&*()');
    });
    unmount();
  });

  it('keeps the placeholder when a paste contains only invalid characters', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await paste(stdin, '!!!');
    await waitFor(() => {
      expect(stdout.lastFrame()).toContain(PLACEHOLDER);
    });
    unmount();
  });

  it('replaces the previous paste instead of appending', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await paste(stdin, 'AAAA');
    await waitFor(() => {
      expect(stdout.lastFrame()).toContain('AAAA');
    });
    await paste(stdin, 'BBBB');
    await waitFor(() => {
      const frame = stdout.lastFrame();
      expect(frame).toContain('BBBB');
      expect(frame).not.toContain('AAAA');
    });
    unmount();
  });

  it('renders provider-specific instructions', async () => {
    const clipboardLine = 'The OAuth URL has been copied to your clipboard.';

    const { stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        provider="gemini"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await waitFor(() => {
      const frame = stdout.lastFrame();
      expect(frame).toContain('Gemini OAuth Authentication');
      expect(frame).toContain(clipboardLine);
    });
    unmount();

    const generic = renderWithProviders(
      <OAuthCodeDialog
        provider="openai"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await waitFor(() => {
      const frame = generic.stdout.lastFrame();
      expect(frame).toContain('Openai OAuth Authentication');
      expect(frame).toContain(
        'Please check your browser and authorize the application.',
      );
      expect(frame).not.toContain(clipboardLine);
    });
    generic.unmount();
  });
});
