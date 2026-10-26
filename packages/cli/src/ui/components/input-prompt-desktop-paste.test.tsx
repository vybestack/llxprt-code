/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import clipboardy from 'clipboardy';
import * as path from 'node:path';
import { act } from 'react';
import { waitFor } from '../../__tests__/async.js';
import {
  renderWithProviders,
  wrapWithProviders,
} from '../../__tests__/render.js';
import { FAST_RETURN_TIMEOUT } from '../contexts/KeypressContext.js';
import * as clipboardImages from '../utils/clipboardUtils.js';
import { disableMouseEvents, enableMouseEvents } from '../utils/mouse.js';
import * as primarySelection from '../utils/primarySelection.js';

import {
  InputPromptWithRealBuffer,
  deferred,
  usePasteTestHarness,
} from '../../__tests__/input-prompt-paste-test-helpers.js';

describe('InputPrompt', () => {
  const fixture = usePasteTestHarness();
  describe('application clipboard paste', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
      {
        text: 'one\r\ntwo\rthree\nfour',
        visible: '[4 lines pasted #1]',
        expanded: 'one\ntwo\nthree\nfour',
      },
      {
        text: 'x'.repeat(1000),
        visible: '[1000 characters pasted #1]',
        expanded: 'x'.repeat(1000),
      },
      { text: 'one\r\ntwo', visible: 'one', expanded: 'one\ntwo' },
      { text: '', visible: 'left:right', expanded: '' },
    ])(
      'inserts and submits clipboard text using terminal paste rules ($visible)',
      async ({ text, visible, expanded }) => {
        vi.spyOn(clipboardy, 'read').mockResolvedValue(text);
        const submissions: string[] = [];
        fixture.props.onSubmit = (value) => {
          submissions.push(value);
        };
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer
            {...fixture.props}
            initialText="left:right"
            initialCursorOffset={5}
          />,
        );
        await act(async () => rendered.stdin.write('\x16'));
        await waitFor(() =>
          expect(rendered.stdout.lastFrame()).toContain(visible),
        );
        const clock = vi
          .spyOn(Date, 'now')
          .mockReturnValue(Date.now() + FAST_RETURN_TIMEOUT + 1);
        await act(async () => rendered.stdin.write('\r'));
        clock.mockRestore();
        await waitFor(() =>
          expect(submissions).toStrictEqual([`left:${expanded}right`]),
        );
        rendered.unmount();
      },
    );

    it('reports a read failure without including the underlying error or changing input', async () => {
      vi.spyOn(clipboardy, 'read').mockRejectedValue(
        new Error('PRIVATE clipboard body'),
      );
      const errors: Array<string | null> = [];
      fixture.props.setQueueErrorMessage = (message) => {
        errors.push(message);
      };
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} initialText="keep" />,
      );
      await act(async () => rendered.stdin.write('\x16'));
      await waitFor(() => expect(errors.join(' ')).toContain('terminal'));
      expect(rendered.stdout.lastFrame()).toContain(
        'Unable to read the clipboard',
      );
      expect(rendered.stdout.lastFrame()).not.toContain('PRIVATE');
      expect(errors.join(' ')).not.toContain('PRIVATE');
      expect(rendered.stdout.lastFrame()).toContain('keep');
      rendered.unmount();
    });

    it('keeps image-first insertion separate from clipboard text', async () => {
      vi.spyOn(clipboardy, 'read').mockResolvedValue(
        'TEXT SHOULD NOT BE INSERTED',
      );
      vi.spyOn(clipboardImages, 'clipboardHasImage').mockResolvedValue(true);
      vi.spyOn(clipboardImages, 'saveClipboardImage').mockResolvedValue(
        path.join('test', 'project', 'src', 'image.png'),
      );
      vi.spyOn(
        clipboardImages,
        'cleanupOldClipboardImages',
      ).mockResolvedValue();
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} />,
      );
      await act(async () => rendered.stdin.write('\x16'));
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain('[Image image.png]'),
      );
      expect(rendered.stdout.lastFrame()).not.toContain('TEXT SHOULD NOT');
      rendered.unmount();
    });
  });

  describe('pending desktop paste', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      disableMouseEvents();
    });

    it.each(['clipboard', 'PRIMARY', 'image'])(
      'inserts delayed %s at the latest caret without losing typed text',
      async (source) => {
        enableMouseEvents();
        const pending = deferred<string>();
        vi.spyOn(clipboardy, 'read').mockImplementation(() => pending.promise);
        vi.spyOn(primarySelection, 'readPrimarySelection').mockImplementation(
          () => pending.promise,
        );
        vi.spyOn(clipboardImages, 'clipboardHasImage').mockResolvedValue(
          source === 'image',
        );
        vi.spyOn(clipboardImages, 'saveClipboardImage').mockImplementation(
          () => pending.promise,
        );
        vi.spyOn(
          clipboardImages,
          'cleanupOldClipboardImages',
        ).mockResolvedValue();
        const submissions: string[] = [];
        fixture.props.onSubmit = (value) => {
          submissions.push(value);
        };
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer
            {...fixture.props}
            initialText="left:right"
            initialCursorOffset={5}
          />,
          { mouseEventsEnabled: true },
        );
        await act(async () =>
          rendered.stdin.write(source === 'PRIMARY' ? '\x1b[<1;10;2M' : '\x16'),
        );
        await act(async () => rendered.stdin.write('typed'));
        await act(async () => rendered.stdin.write('\x01'));
        await act(async () =>
          pending.resolve(
            source === 'image'
              ? path.join('test', 'project', 'src', 'image.png')
              : 'a\nb\nc\nd',
          ),
        );
        await waitFor(() =>
          expect(rendered.stdout.lastFrame()).toContain(
            source === 'image' ? '[Image image.png]' : '[4 lines pasted #1]',
          ),
        );
        const clock = vi
          .spyOn(Date, 'now')
          .mockReturnValue(Date.now() + FAST_RETURN_TIMEOUT + 1);
        await act(async () => rendered.stdin.write('\r'));
        clock.mockRestore();
        await waitFor(() =>
          expect(submissions).toStrictEqual([
            source === 'image'
              ? '@image.png left:typedright'
              : 'a\nb\nc\ndleft:typedright',
          ]),
        );
        rendered.unmount();
      },
    );

    it('preserves both overlapping clipboard reads at their completion-time caret', async () => {
      const first = deferred<string>();
      const second = deferred<string>();
      vi.spyOn(clipboardy, 'read')
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);
      const submissions: string[] = [];
      fixture.props.onSubmit = (value) => {
        submissions.push(value);
      };
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} initialText="end" />,
      );
      await act(async () => rendered.stdin.write('\x16'));
      await act(async () => rendered.stdin.write('\x16'));
      await act(async () => second.resolve('2\n2\n2\n2'));
      await waitFor(() => expect(rendered.stdout.lastFrame()).toContain('#1'));
      await act(async () => rendered.stdin.write('\x01'));
      await act(async () => first.resolve('1\n1\n1\n1'));
      await waitFor(() => expect(rendered.stdout.lastFrame()).toContain('#2'));
      const clock = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + FAST_RETURN_TIMEOUT + 1);
      await act(async () => rendered.stdin.write('\r'));
      clock.mockRestore();
      await waitFor(() =>
        expect(submissions).toStrictEqual(['1\n1\n1\n1end2\n2\n2\n2']),
      );
      rendered.unmount();
    });

    it.each([
      'blur',
      'refocus',
      'shell',
      'unmount',
      'mouse-off',
      'mouse-cycle',
    ])(
      'discards delayed PRIMARY success and errors after %s',
      async (transition) => {
        enableMouseEvents();
        const success = deferred<string>();
        const failure = deferred<string>();
        vi.spyOn(primarySelection, 'readPrimarySelection')
          .mockImplementationOnce(() => success.promise)
          .mockImplementationOnce(() => failure.promise);
        const errors: Array<string | null> = [];
        fixture.props.setQueueErrorMessage = (message) => {
          errors.push(message);
        };
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer {...fixture.props} initialText="keep" />,
          { mouseEventsEnabled: true },
        );
        await act(async () =>
          rendered.stdin.write('\x1b[<1;10;2M\x1b[<1;10;2M'),
        );
        if (transition === 'unmount') {
          rendered.unmount();
        } else if (transition.startsWith('mouse')) {
          disableMouseEvents();
          if (transition === 'mouse-cycle') enableMouseEvents();
        } else {
          rendered.rerender(
            wrapWithProviders(
              <InputPromptWithRealBuffer
                {...{
                  ...fixture.props,
                  focus: transition === 'shell',
                  isEmbeddedShellFocused: transition === 'shell',
                }}
                initialText="keep"
              />,
              { mouseEventsEnabled: true },
            ),
          );
          if (transition === 'refocus')
            rendered.rerender(
              wrapWithProviders(
                <InputPromptWithRealBuffer
                  {...fixture.props}
                  initialText="keep"
                />,
                { mouseEventsEnabled: true },
              ),
            );
        }
        await act(async () => {
          success.resolve('STALE_PRIMARY');
          failure.reject(new Error('PRIVATE backend'));
        });
        expect(errors).toStrictEqual([]);
        expect(rendered.stdout.lastFrame()).not.toContain('STALE_PRIMARY');
        if (transition !== 'unmount') rendered.unmount();
      },
    );

    it.each(['text', 'image'])(
      'discards clipboard %s after blur and refocus',
      async (kind) => {
        const pending = deferred<string>();
        vi.spyOn(clipboardy, 'read').mockImplementation(() => pending.promise);
        vi.spyOn(clipboardImages, 'clipboardHasImage').mockResolvedValue(
          kind === 'image',
        );
        vi.spyOn(clipboardImages, 'saveClipboardImage').mockImplementation(
          () => pending.promise,
        );
        vi.spyOn(
          clipboardImages,
          'cleanupOldClipboardImages',
        ).mockResolvedValue();
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer {...fixture.props} initialText="keep" />,
        );
        await act(async () => rendered.stdin.write('\x16'));
        rendered.rerender(
          wrapWithProviders(
            <InputPromptWithRealBuffer
              {...{ ...fixture.props, focus: false }}
              initialText="keep"
            />,
          ),
        );
        rendered.rerender(
          wrapWithProviders(
            <InputPromptWithRealBuffer {...fixture.props} initialText="keep" />,
          ),
        );
        await act(async () =>
          pending.resolve(
            kind === 'image'
              ? path.join('test', 'project', 'src', 'stale.png')
              : 'STALE_CLIPBOARD',
          ),
        );
        expect(rendered.stdout.lastFrame()).not.toContain('STALE_CLIPBOARD');
        expect(rendered.stdout.lastFrame()).not.toContain('stale.png');
        rendered.unmount();
      },
    );

    it('does not read PRIMARY when live mouse reporting is off despite provider settings', async () => {
      disableMouseEvents();
      const reads: string[] = [];
      vi.spyOn(primarySelection, 'readPrimarySelection').mockImplementation(
        async () => {
          reads.push('read');
          return 'selection';
        },
      );
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} />,
        { mouseEventsEnabled: true },
      );
      await act(async () => rendered.stdin.write('\x1b[<1;10;2M'));
      expect(reads).toStrictEqual([]);
      rendered.unmount();
    });

    it('renders redacted PRIMARY failures while preserving the prompt', async () => {
      enableMouseEvents();
      vi.spyOn(primarySelection, 'readPrimarySelection').mockRejectedValue(
        new Error('PRIVATE selection'),
      );
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} initialText="keep" />,
        { mouseEventsEnabled: true },
      );
      await act(async () => rendered.stdin.write('\x1b[<1;10;2M'));
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain(
          'Unable to read the Linux PRIMARY',
        ),
      );
      expect(rendered.stdout.lastFrame()).toContain('keep');
      expect(rendered.stdout.lastFrame()).not.toContain('PRIVATE');
      rendered.unmount();
    });
  });
  describe('dispatched mouse and copy input', () => {
    beforeEach(() => enableMouseEvents());
    afterEach(() => {
      disableMouseEvents();
      vi.restoreAllMocks();
    });

    it.each([
      { protocol: 'SGR', click: '\x1b[<1;10;2M\x1b[<1;10;2m' },
      {
        protocol: 'SGR anonymous release',
        click: '\x1b[<1;10;2M\x1b[<3;10;2m',
      },
      {
        protocol: 'X11 anonymous release',
        click:
          '\x1b[M' +
          String.fromCharCode(33, 42, 34) +
          '\x1b[M' +
          String.fromCharCode(35, 42, 34),
      },
    ])('submits one PRIMARY paste per $protocol click', async ({ click }) => {
      vi.spyOn(primarySelection, 'readPrimarySelection').mockResolvedValue(
        'first\nsecond\nthird\nfourth',
      );
      const submissions: string[] = [];
      fixture.props.onSubmit = (value) => {
        submissions.push(value);
      };
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} initialText="prefix:" />,
        { mouseEventsEnabled: true },
      );
      await act(async () => rendered.stdin.write(click));
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain('[4 lines pasted #1]'),
      );
      const clock = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + FAST_RETURN_TIMEOUT + 1);
      await act(async () => rendered.stdin.write('\r'));
      clock.mockRestore();
      await waitFor(() =>
        expect(submissions).toStrictEqual([
          'prefix:first\nsecond\nthird\nfourth',
        ]),
      );
      rendered.unmount();
    });

    it('retains right-release regular clipboard paste', async () => {
      vi.spyOn(clipboardy, 'read').mockResolvedValue('right\r\npaste');
      const submissions: string[] = [];
      fixture.props.onSubmit = (value) => {
        submissions.push(value);
      };
      const rendered = renderWithProviders(
        <InputPromptWithRealBuffer {...fixture.props} initialText="prefix:" />,
        { mouseEventsEnabled: true },
      );
      await act(async () => rendered.stdin.write('\x1b[<2;10;2m'));
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain('paste'),
      );
      const clock = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + FAST_RETURN_TIMEOUT + 1);
      await act(async () => rendered.stdin.write('\r'));
      clock.mockRestore();
      await waitFor(() =>
        expect(submissions).toStrictEqual(['prefix:right\npaste']),
      );
      rendered.unmount();
    });

    it.each(['\x1b[99;6u', '\x1b[99;9u'])(
      'keeps prompt text on a dispatched copy chord %s and clears on bare Ctrl+C',
      async (sequence) => {
        const rendered = renderWithProviders(
          <InputPromptWithRealBuffer
            {...fixture.props}
            initialText="keep-copy-text"
          />,
        );
        await act(async () => rendered.stdin.write(sequence));
        expect(rendered.stdout.lastFrame()).toContain('keep-copy-text');
        await act(async () => rendered.stdin.write('\x03'));
        await waitFor(() =>
          expect(rendered.stdout.lastFrame()).not.toContain('keep-copy-text'),
        );
        rendered.unmount();
      },
    );
  });
});
