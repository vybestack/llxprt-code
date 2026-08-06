/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { act } from 'react';
import { describe, expect, it, vi, beforeEach } from 'bun:test';

// Under Bun, ink is redirected to a stub by a resolution plugin rather than a
// module mock, so there is nothing to unmock.

import { KeypressProvider } from '../contexts/KeypressContext.js';
import {
  ProfileListDialog,
  type ProfileListItem,
} from './ProfileListDialog.js';

enum TerminalKeys {
  TAB = '\t',
  ESCAPE = '\u001B',
}

const mockIsNarrow = { value: false };
vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: () => ({
    width: mockIsNarrow.value ? 60 : 120,
    breakpoint: mockIsNarrow.value ? 'NARROW' : 'WIDE',
    isNarrow: mockIsNarrow.value,
    isStandard: !mockIsNarrow.value,
    isWide: !mockIsNarrow.value,
  }),
}));

const profiles: ProfileListItem[] = [
  { name: 'alpha', type: 'standard', provider: 'openai', model: 'gpt-4' },
  { name: 'beta', type: 'standard', provider: 'anthropic', model: 'opus' },
  { name: 'gamma', type: 'loadbalancer' },
];

function renderList(
  overrides: {
    onDelete?: ReturnType<typeof vi.fn>;
    onClose?: ReturnType<typeof vi.fn>;
    onSelect?: ReturnType<typeof vi.fn>;
    onViewDetail?: ReturnType<typeof vi.fn>;
    activeProfileName?: string;
    defaultProfileName?: string;
    items?: ProfileListItem[];
  } = {},
) {
  const onDelete = overrides.onDelete ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const onSelect = overrides.onSelect ?? vi.fn();
  const onViewDetail = overrides.onViewDetail ?? vi.fn();

  const result = render(
    <KeypressProvider>
      <ProfileListDialog
        profiles={overrides.items ?? profiles}
        onSelect={onSelect}
        onClose={onClose}
        onViewDetail={onViewDetail}
        onDelete={onDelete}
        activeProfileName={overrides.activeProfileName}
        defaultProfileName={overrides.defaultProfileName}
      />
    </KeypressProvider>,
  );

  return { ...result, onDelete, onClose, onSelect, onViewDetail };
}

describe('ProfileListDialog direct delete (issue #2494)', () => {
  beforeEach(() => {
    mockIsNarrow.value = false;
  });

  it('advertises the delete key in wide controls', () => {
    const { lastFrame } = renderList();
    expect(lastFrame() ?? '').toContain('[d] Delete');
  });

  it('deletes from the list after confirmation without opening details', async () => {
    const { stdin, lastFrame, onDelete, onViewDetail } = renderList();

    await act(async () => {
      stdin.write(TerminalKeys.TAB); // exit search → nav
    });
    await act(async () => {
      stdin.write('d');
    });

    expect(lastFrame() ?? '').toMatch(/Delete profile 'alpha'/);
    expect(onDelete).not.toHaveBeenCalled();

    await act(async () => {
      stdin.write('y');
    });

    expect(onDelete).toHaveBeenCalledWith('alpha');
    expect(onViewDetail).not.toHaveBeenCalled();
  });

  it('cancels delete confirmation with n', async () => {
    const { stdin, lastFrame, onDelete } = renderList();

    await act(async () => {
      stdin.write(TerminalKeys.TAB);
    });
    await act(async () => {
      stdin.write('d');
    });
    await act(async () => {
      stdin.write('n');
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').not.toMatch(/Delete profile/);
  });

  it('cancels delete confirmation with Esc without closing the dialog', async () => {
    const { stdin, lastFrame, onDelete, onClose } = renderList();

    await act(async () => {
      stdin.write(TerminalKeys.TAB);
    });
    await act(async () => {
      stdin.write('d');
    });
    await act(async () => {
      stdin.write(TerminalKeys.ESCAPE);
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain('Profile List');
  });

  it('mentions active/default in the confirmation copy', async () => {
    const { stdin, lastFrame } = renderList({
      activeProfileName: 'alpha',
      defaultProfileName: 'alpha',
    });

    await act(async () => {
      stdin.write(TerminalKeys.TAB);
    });
    await act(async () => {
      stdin.write('d');
    });

    expect(lastFrame() ?? '').toMatch(/active/);
    expect(lastFrame() ?? '').toMatch(/default/);
  });

  it('keeps delete reachable in narrow layout via Tab then d', async () => {
    mockIsNarrow.value = true;
    const { stdin, lastFrame, onDelete } = renderList();

    await act(async () => {
      stdin.write(TerminalKeys.TAB);
    });
    await act(async () => {
      stdin.write('d');
    });

    expect(lastFrame() ?? '').toMatch(/Delete profile 'alpha'/);

    await act(async () => {
      stdin.write('y');
    });

    expect(onDelete).toHaveBeenCalledWith('alpha');
  });

  it('clamps selection when the selected profile is removed from props', async () => {
    const { stdin, rerender, lastFrame } = renderList();

    await act(async () => {
      stdin.write(TerminalKeys.TAB);
    });

    // Move to last item (gamma) with down arrows in 3-column wide layout:
    // index 0 -> right -> 1 -> right -> 2
    await act(async () => {
      stdin.write('\u001B[C'); // right
    });
    await act(async () => {
      stdin.write('\u001B[C');
    });

    expect(lastFrame() ?? '').toContain('Selected: gamma');

    await act(async () => {
      rerender(
        <KeypressProvider>
          <ProfileListDialog
            profiles={profiles.slice(0, 2)}
            onSelect={vi.fn()}
            onClose={vi.fn()}
            onViewDetail={vi.fn()}
            onDelete={vi.fn()}
          />
        </KeypressProvider>,
      );
    });

    // Index should clamp to last remaining item (beta at index 1).
    expect(lastFrame() ?? '').toContain('Selected: beta');
  });
});
