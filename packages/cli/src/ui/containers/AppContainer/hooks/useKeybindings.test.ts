/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import type { Key } from '../../../hooks/useKeypress.js';
import { useKeybindings } from './useKeybindings.js';

const useKeypressMock = vi.hoisted(() => vi.fn());
const isMouseEventsActiveMock = vi.hoisted(() => vi.fn());
const setMouseEventsActiveMock = vi.hoisted(() => vi.fn());
const disableMouseEventsMock = vi.hoisted(() => vi.fn());
const enableMouseEventsMock = vi.hoisted(() => vi.fn());
const getLastActivePtyIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useKeypress.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../hooks/useKeypress.js')
  >('../../../hooks/useKeypress.js');

  return {
    ...actual,
    useKeypress: useKeypressMock,
  };
});

vi.mock('../../../utils/mouse.js', () => ({
  isMouseEventsActive: isMouseEventsActiveMock,
  setMouseEventsActive: setMouseEventsActiveMock,
  disableMouseEvents: disableMouseEventsMock,
  enableMouseEvents: enableMouseEventsMock,
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  return {
    ...actual,
    ShellExecutionService: {
      getLastActivePtyId: getLastActivePtyIdMock,
    },
    DebugLogger: class {
      log(): void {
        // noop for tests
      }
    },
  };
});

interface HookHarness {
  requestCtrlCExit: ReturnType<typeof vi.fn>;
  requestCtrlDExit: ReturnType<typeof vi.fn>;
  cancelOngoingRequest: ReturnType<typeof vi.fn>;
  setShowErrorDetails: ReturnType<typeof vi.fn>;
  setShowToolDescriptions: ReturnType<typeof vi.fn>;
  setRenderMarkdown: ReturnType<typeof vi.fn>;
  setIsTodoPanelCollapsed: ReturnType<typeof vi.fn>;
  setConstrainHeight: ReturnType<typeof vi.fn>;
  refreshStatic: ReturnType<typeof vi.fn>;
  addItem: ReturnType<typeof vi.fn>;
  handleSlashCommand: ReturnType<typeof vi.fn>;
  setEmbeddedShellFocused: ReturnType<typeof vi.fn>;
  setCopyModeEnabled: ReturnType<typeof vi.fn>;
}

const createHarness = (): HookHarness => ({
  requestCtrlCExit: vi.fn(),
  requestCtrlDExit: vi.fn(),
  cancelOngoingRequest: vi.fn(),
  setShowErrorDetails: vi.fn(),
  setShowToolDescriptions: vi.fn(),
  setRenderMarkdown: vi.fn(),
  setIsTodoPanelCollapsed: vi.fn(),
  setConstrainHeight: vi.fn(),
  refreshStatic: vi.fn(),
  addItem: vi.fn().mockReturnValue(1),
  handleSlashCommand: vi.fn().mockResolvedValue({ type: 'handled' }),
  setEmbeddedShellFocused: vi.fn(),
  setCopyModeEnabled: vi.fn(),
});

const renderUseKeybindings = (
  harness: HookHarness,
  overrides: Partial<Parameters<typeof useKeybindings>[0]> = {},
) => {
  renderHook(() =>
    useKeybindings({
      exit: {
        requestCtrlCExit: harness.requestCtrlCExit,
        requestCtrlDExit: harness.requestCtrlDExit,
        ctrlCPressedOnce: false,
        cancelOngoingRequest: harness.cancelOngoingRequest,
        bufferTextLength: 0,
      },
      display: {
        showErrorDetails: false,
        setShowErrorDetails: harness.setShowErrorDetails,
        showToolDescriptions: false,
        setShowToolDescriptions: harness.setShowToolDescriptions,
        renderMarkdown: true,
        setRenderMarkdown: harness.setRenderMarkdown,
        isTodoPanelCollapsed: false,
        setIsTodoPanelCollapsed: harness.setIsTodoPanelCollapsed,
        constrainHeight: true,
        setConstrainHeight: harness.setConstrainHeight,
        refreshStatic: harness.refreshStatic,
        addItem: harness.addItem,
        handleSlashCommand: harness.handleSlashCommand,
      },
      shell: {
        activeShellPtyId: null,
        setEmbeddedShellFocused: harness.setEmbeddedShellFocused,
        getEnableInteractiveShell: () => false,
      },
      copyMode: {
        copyModeEnabled: false,
        setCopyModeEnabled: harness.setCopyModeEnabled,
        useAlternateBuffer: false,
      },
      ideContext: {
        getIdeMode: () => false,
        ideContextState: undefined,
      },
      mcp: {
        getMcpServers: () => undefined,
      },
      ...overrides,
    }),
  );
};

const getRegisteredHandler = (): ((key: Key) => void) => {
  const handler = useKeypressMock.mock.calls.at(-1)?.[0] as
    | ((key: Key) => void)
    | undefined;
  expect(handler).toBeTypeOf('function');
  return handler as (key: Key) => void;
};

describe('useKeybindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMouseEventsActiveMock.mockReturnValue(false);
    getLastActivePtyIdMock.mockReturnValue(null);
  });

  it('copy mode consumes keypress before exit handling', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      copyMode: {
        copyModeEnabled: true,
        setCopyModeEnabled: harness.setCopyModeEnabled,
        useAlternateBuffer: true,
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({ ctrl: true, name: 'c' } as Key);
    });

    expect(harness.setCopyModeEnabled).toHaveBeenCalledWith(false);
    expect(enableMouseEventsMock).toHaveBeenCalledTimes(1);
    expect(harness.requestCtrlCExit).not.toHaveBeenCalled();
    expect(harness.cancelOngoingRequest).not.toHaveBeenCalled();
  });

  it('Ctrl+C triggers cancel and exit flow on first press', () => {
    const harness = createHarness();

    renderUseKeybindings(harness);

    const handler = getRegisteredHandler();

    act(() => {
      handler({ ctrl: true, name: 'c' } as Key);
    });

    expect(harness.cancelOngoingRequest).toHaveBeenCalledTimes(1);
    expect(harness.requestCtrlCExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+D is ignored for exit when buffer has text', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      exit: {
        requestCtrlCExit: harness.requestCtrlCExit,
        requestCtrlDExit: harness.requestCtrlDExit,
        ctrlCPressedOnce: false,
        cancelOngoingRequest: harness.cancelOngoingRequest,
        bufferTextLength: 10,
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({ ctrl: true, name: 'd' } as Key);
    });

    expect(harness.requestCtrlDExit).not.toHaveBeenCalled();
  });

  it('toggle mouse events flips mouse state and adds status message', () => {
    const harness = createHarness();
    isMouseEventsActiveMock.mockReturnValue(false);

    renderUseKeybindings(harness);

    const handler = getRegisteredHandler();

    act(() => {
      handler({
        ctrl: true,
        meta: false,
        shift: false,
        paste: false,
        name: '\\\\',
        sequence: '\x1c',
      } as Key);
    });

    expect(setMouseEventsActiveMock).toHaveBeenCalledWith(true);
    expect(harness.addItem).toHaveBeenCalledWith(
      {
        type: 'info',
        text: 'Mouse events enabled (wheel scrolling + in-app selection/copy on).',
      },
      expect.any(Number),
    );
  });

  it('toggle tool descriptions dispatches slash command when MCP servers are configured', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      mcp: {
        getMcpServers: () => ({ serverA: {} }),
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({ ctrl: true, name: 't' } as Key);
    });

    expect(harness.setShowToolDescriptions).toHaveBeenCalledWith(true);
    expect(harness.handleSlashCommand).toHaveBeenCalledWith('/mcp desc');
  });

  it('toggles markdown and refreshes static content', () => {
    const harness = createHarness();

    renderUseKeybindings(harness);

    const handler = getRegisteredHandler();

    act(() => {
      handler({
        ctrl: false,
        meta: true,
        shift: false,
        paste: false,
        name: 'm',
        sequence: 'm',
      } as Key);
    });

    expect(harness.setRenderMarkdown).toHaveBeenCalledWith(false);
    expect(harness.refreshStatic).toHaveBeenCalledTimes(1);
  });

  it('enters constrained mode before processing display command when unconstrained', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      display: {
        showErrorDetails: false,
        setShowErrorDetails: harness.setShowErrorDetails,
        showToolDescriptions: false,
        setShowToolDescriptions: harness.setShowToolDescriptions,
        renderMarkdown: true,
        setRenderMarkdown: harness.setRenderMarkdown,
        isTodoPanelCollapsed: false,
        setIsTodoPanelCollapsed: harness.setIsTodoPanelCollapsed,
        constrainHeight: false,
        setConstrainHeight: harness.setConstrainHeight,
        refreshStatic: harness.refreshStatic,
        addItem: harness.addItem,
        handleSlashCommand: harness.handleSlashCommand,
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({
        ctrl: false,
        meta: true,
        shift: false,
        paste: false,
        name: 'm',
        sequence: 'm',
      } as Key);
    });

    expect(harness.setConstrainHeight).toHaveBeenCalledWith(true);
    expect(harness.setRenderMarkdown).toHaveBeenCalledWith(false);
  });

  it('toggles embedded shell focus when interactive shell is enabled and a pty exists', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      shell: {
        activeShellPtyId: 42,
        setEmbeddedShellFocused: harness.setEmbeddedShellFocused,
        getEnableInteractiveShell: () => true,
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({ ctrl: true, name: 'f' } as Key);
    });

    expect(harness.setEmbeddedShellFocused).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('runs /ide status command only when IDE mode and context are both present', () => {
    const harness = createHarness();

    renderUseKeybindings(harness, {
      ideContext: {
        getIdeMode: () => true,
        ideContextState: { id: 'ctx' },
      },
    });

    const handler = getRegisteredHandler();

    act(() => {
      handler({
        ctrl: true,
        meta: false,
        shift: false,
        paste: false,
        name: 'g',
        sequence: 'g',
      } as Key);
    });

    expect(harness.handleSlashCommand).toHaveBeenCalledWith('/ide status');
  });
});
