/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'bun:test';
import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders, waitFor } from '../../__tests__/render.js';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import { act, useState } from 'react';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';
import { OAuthUIBridge } from '@vybestack/llxprt-code-auth';

const PLACEHOLDER = '(paste only - typing disabled)';

const paste = (
  stdin: { write: (data: string) => void },
  code: string,
): Promise<void> =>
  act(async () => {
    stdin.write(`\x1b[200~${code}\x1b[201~`);
  });

describe('OAuthCodeDialog', () => {
  let bridge: OAuthUIBridge;

  beforeEach(() => {
    bridge = new OAuthUIBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['managed', 'legacy'])(
    'blocks duplicate submissions while the same %s attempt is waiting',
    async (mode) => {
      if (mode === 'managed') bridge.beginDialog('duplicate', 'claudecode');
      function Host(): React.JSX.Element {
        const [codes, setCodes] = useState<string[]>([]);
        return (
          <>
            <OAuthCodeDialog
              dialogState={bridge}
              provider="claudecode"
              onClose={() => {}}
              onSubmit={(code) => setCodes((old) => [...old, code])}
            />
            <Text color={Colors.Foreground}>Delivered: {codes.length}</Text>
          </>
        );
      }
      const ui = renderWithProviders(<Host />);
      try {
        await paste(ui.stdin, 'first-code');
        await waitFor(() => expect(ui.lastFrame()).toContain('first-code'));
        await act(async () => {
          ui.stdin.write('\r');
        });
        await waitFor(() => expect(ui.lastFrame()).toContain('Delivered: 1'));
        await paste(ui.stdin, 'duplicate-code');
        await act(async () => {
          ui.stdin.write('\r');
        });
        await waitFor(() => {
          expect(ui.lastFrame()).toContain(
            'Waiting for authentication to finish',
          );
          expect(ui.lastFrame()).toContain('Delivered: 1');
          expect(ui.lastFrame()).not.toContain('duplicate-code');
        });
      } finally {
        ui.unmount();
      }
    },
  );

  it('ignores typed characters, keeping the paste-only placeholder and no code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
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
    } finally {
      // Cleanup must run even when an assertion fails: a leaked Ink instance
      // keeps stdin listeners and timers alive and interferes with later tests.
      unmount();
    }
  });

  it('delivers content from a bracketed paste', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
      await paste(stdin, 'ABCd123');
      await waitFor(() => {
        const frame = stdout.lastFrame();
        expect(frame).toContain('ABCd123');
        expect(frame).not.toContain(PLACEHOLDER);
      });
    } finally {
      unmount();
    }
  });

  it('closes on Escape: onClose once, onSubmit never', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
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
    } finally {
      unmount();
    }
  });

  it('submits the trimmed pasted code on Return, then closes', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
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
    } finally {
      unmount();
    }
  });

  it('keeps Claude Code authentication visibly pending after submission', async () => {
    function PendingDialog(): React.JSX.Element {
      const [closed, setClosed] = useState(false);
      const [submitted, setSubmitted] = useState('');
      return closed ? (
        <Text color={Colors.Foreground}>Dialog closed</Text>
      ) : (
        <>
          <OAuthCodeDialog
            dialogState={bridge}
            provider="claudecode"
            onClose={() => setClosed(true)}
            onSubmit={setSubmitted}
          />
          <Text color={Colors.Foreground}>
            {submitted.length > 0 ? 'Code delivered' : 'No submission'}
          </Text>
        </>
      );
    }
    const { stdin, stdout, unmount } = renderWithProviders(<PendingDialog />);
    try {
      await paste(stdin, 'pending-code');
      await waitFor(() => expect(stdout.lastFrame()).toContain('pending-code'));
      await act(async () => {
        stdin.write('\r');
      });
      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('Code delivered');
        expect(stdout.lastFrame()).toContain(
          'Waiting for authentication to finish',
        );
        expect(stdout.lastFrame()).not.toContain('Dialog closed');
      });
    } finally {
      unmount();
    }
  });

  it('does nothing on Return with an empty code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
      await act(async () => {
        stdin.write('\r');
      });
      await waitFor(() => {
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      });
    } finally {
      unmount();
    }
  });

  it('filters invalid characters out of a pasted code', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
      await paste(stdin, '4/Ab!@#$%^&*()cde');
      await waitFor(() => {
        const frame = stdout.lastFrame();
        // Allowed set is [a-zA-Z0-9/_#-]: '#' is valid, so only
        // '!@$%^&*()' are stripped, leaving '4/Ab#cde'.
        expect(frame).toContain('4/Ab#cde');
        expect(frame).not.toContain('4/Ab!');
        expect(frame).not.toContain('@$%^&*()');
      });
    } finally {
      unmount();
    }
  });

  it('keeps the placeholder when a paste contains only invalid characters', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
      await paste(stdin, '!!!');
      await waitFor(() => {
        expect(stdout.lastFrame()).toContain(PLACEHOLDER);
      });
    } finally {
      unmount();
    }
  });

  it('replaces the previous paste instead of appending', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { stdin, stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    try {
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
    } finally {
      unmount();
    }
  });

  it('renders provider-specific instructions', async () => {
    const clipboardLine = 'The OAuth URL has been copied to your clipboard.';

    const { stdout, unmount } = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="gemini"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    try {
      await waitFor(() => {
        const frame = stdout.lastFrame();
        expect(frame).toContain('Gemini OAuth Authentication');
        expect(frame).toContain(clipboardLine);
      });
    } finally {
      unmount();
    }

    const generic = renderWithProviders(
      <OAuthCodeDialog
        dialogState={bridge}
        provider="openai"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    try {
      await waitFor(() => {
        const frame = generic.stdout.lastFrame();
        expect(frame).toContain('Openai OAuth Authentication');
        expect(frame).toContain(
          'Please check your browser and authorize the application.',
        );
        expect(frame).not.toContain(clipboardLine);
      });
    } finally {
      generic.unmount();
    }
  });
});
