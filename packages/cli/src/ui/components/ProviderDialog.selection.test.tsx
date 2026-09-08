/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders as render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { act } from 'react';
import { ProviderDialog } from './ProviderDialog.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

const realUseTerminalSizeModule = {
  ...(await import('../hooks/useTerminalSize.js')),
};

void vi.mock('../hooks/useTerminalSize.js', () =>
  automock(realUseTerminalSizeModule),
);

const PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'qwen',
  'fireworks',
  'cerebras',
];
const CURRENT_PROVIDER = 'openai';
const WIDE_COLUMNS = 180;

// The kitty/CSI-u escape keycode. A lone ESC is decodable, but only after
// an ESC_TIMEOUT (100ms) flush, so the tests drive the synchronous keycode
// form (the same sequence the real terminal sends).
const ESCAPE_KEY = '\u001B[27u';

function renderProviderDialog(
  overrides: {
    providers?: string[];
    currentProvider?: string;
  } = {},
) {
  const providers = overrides.providers ?? PROVIDERS;
  const currentProvider = overrides.currentProvider ?? CURRENT_PROVIDER;
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <ProviderDialog
      providers={providers}
      currentProvider={currentProvider}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { ...result, providers, onSelect, onClose };
}

describe('ProviderDialog selection semantics', () => {
  let mockUseTerminalSize: Mock<typeof useTerminalSize>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as Mock<typeof useTerminalSize>;
    mockUseTerminalSize.mockReturnValue({ columns: WIDE_COLUMNS, rows: 24 });
  });

  it('shows an empty-results message when the search term matches nothing', async () => {
    const { stdin, lastFrame, providers } = renderProviderDialog();

    await act(async () => {
      stdin.write('\t'); // enter search mode
    });
    for (const char of 'zzzz') {
      await act(async () => {
        stdin.write(char);
      });
    }

    const output = lastFrame() ?? '';
    expect(output).toContain('No providers match');
    expect(output).toContain('zzzz');
    for (const name of providers) {
      expect(output).not.toContain(name);
    }
  });

  it('confirms the current provider on Enter without closing', async () => {
    const { stdin, lastFrame, onSelect, onClose, providers } =
      renderProviderDialog();

    await act(async () => {
      stdin.write('\r');
    });

    const expected = providers[providers.indexOf(CURRENT_PROVIDER)];
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expected);
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain(expected);
  });

  it('confirms the provider after moving focus with Right', async () => {
    const { stdin, onSelect, onClose, providers } = renderProviderDialog();

    await act(async () => {
      stdin.write('\u001B[C'); // right
    });
    await act(async () => {
      stdin.write('\r'); // enter
    });

    const expected = providers[providers.indexOf(CURRENT_PROVIDER) + 1];
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expected);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape with an empty search', async () => {
    const { stdin, onClose, onSelect } = renderProviderDialog();

    await act(async () => {
      stdin.write(ESCAPE_KEY);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clears the search term on Escape before closing on a second Escape', async () => {
    const { stdin, lastFrame, onClose, onSelect, providers } =
      renderProviderDialog();

    await act(async () => {
      stdin.write('\t'); // enter search mode
    });
    for (const char of 'en') {
      await act(async () => {
        stdin.write(char);
      });
    }

    const term = 'en';
    const matching = providers.filter((name) =>
      name.toLowerCase().includes(term),
    );
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.length).toBeLessThan(providers.length);
    expect(lastFrame() ?? '').toContain(
      `(Found ${String(matching.length)} of ${String(providers.length)} providers)`,
    );

    await act(async () => {
      stdin.write(ESCAPE_KEY);
    });

    const frameAfterFirstEscape = lastFrame() ?? '';
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    // The found-count line only renders while a search term is present, so its
    // disappearance is the evidence that the first Escape cleared the term.
    expect(frameAfterFirstEscape).not.toContain('Found');

    await act(async () => {
      stdin.write(ESCAPE_KEY);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    // Repeated deliberately: cancelling must stay side-effect free across both
    // Escapes, not just the first one.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not select or close when Enter is pressed with zero matches', async () => {
    const { stdin, lastFrame, onSelect, onClose } = renderProviderDialog();

    await act(async () => {
      stdin.write('\t'); // enter search mode
    });
    for (const char of 'zzzz') {
      await act(async () => {
        stdin.write(char);
      });
    }
    await act(async () => {
      stdin.write('\r');
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain('No providers match');
  });
});
