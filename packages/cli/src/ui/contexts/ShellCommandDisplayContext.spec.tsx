/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { act, useState } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import {
  createMockSettings,
  renderWithProviders,
} from '../../test-utils/render.js';
import { SHELL_NAME } from '../constants.js';
import type { KeypressHandler } from './KeypressContext.js';
import { ToolCallStatus } from '../types.js';
import { useShellCommandDisplay } from './ShellCommandDisplayContext.js';

const keypress = vi.hoisted(() => ({
  handler: undefined as KeypressHandler | undefined,
}));

vi.mock('../hooks/useKeypress.js', () => ({
  useKeypress: (handler: KeypressHandler): void => {
    keypress.handler = handler;
  },
}));

interface DisplayProbeProps {
  name: string;
  status: ToolCallStatus;
  onDisplay: (showFullDescription: boolean) => void;
}

const DisplayProbe: React.FC<DisplayProbeProps> = ({
  name,
  status,
  onDisplay,
}) => {
  const showFullDescription = useShellCommandDisplay(
    'shell-call-1',
    name,
    status,
    true,
  );
  onDisplay(showFullDescription);
  return null;
};

interface RemountHarnessProps {
  name: string;
  onDisplay: (showFullDescription: boolean) => void;
  onAdvance: (advance: () => void) => void;
}

const RemountHarness: React.FC<RemountHarnessProps> = ({
  name,
  onDisplay,
  onAdvance,
}) => {
  const [phase, setPhase] = useState(0);
  onAdvance(() => setPhase((current) => current + 1));
  if (phase === 1) {
    return null;
  }
  return (
    <DisplayProbe
      name={name}
      status={phase === 0 ? ToolCallStatus.Executing : ToolCallStatus.Success}
      onDisplay={onDisplay}
    />
  );
};

function renderHarness(
  alwaysDisplayFullShellCommand: boolean,
  name = SHELL_NAME,
): ReturnType<typeof renderWithProviders> & {
  getDisplay: () => boolean | undefined;
  advance: () => void;
  pressCtrlR: () => void;
} {
  let currentDisplay: boolean | undefined;
  let advance = (): void => {};
  const settings = createMockSettings({
    ui: { alwaysDisplayFullShellCommand },
  });
  const renderResult = renderWithProviders(
    <RemountHarness
      name={name}
      onDisplay={(showFullDescription) => {
        currentDisplay = showFullDescription;
      }}
      onAdvance={(nextAdvance) => {
        advance = nextAdvance;
      }}
    />,
    { settings },
  );
  return {
    ...renderResult,
    getDisplay: () => currentDisplay,
    advance: () => advance(),
    pressCtrlR: () => {
      act(() =>
        keypress.handler?.({
          name: 'r',
          ctrl: true,
          meta: false,
          shift: false,
          sequence: '\x12',
        }),
      );
    },
  };
}

describe('shell command description display', () => {
  it('expands new shell calls when the setting is true', () => {
    const { getDisplay } = renderHarness(true);

    expect(getDisplay()).toBe(true);
  });

  it('collapses new shell calls when the setting is false', () => {
    const { getDisplay } = renderHarness(false);

    expect(getDisplay()).toBe(false);
  });

  it('toggles with Ctrl-R and preserves the choice after remount', () => {
    const { advance, getDisplay, pressCtrlR } = renderHarness(true);

    pressCtrlR();
    expect(getDisplay()).toBe(false);

    act(() => advance());
    act(() => advance());

    expect(getDisplay()).toBe(false);
  });

  it('does not expand non-shell tool descriptions', () => {
    const { getDisplay, pressCtrlR } = renderHarness(true, 'read_file');

    expect(getDisplay()).toBe(false);
    pressCtrlR();

    expect(getDisplay()).toBe(false);
  });
});
