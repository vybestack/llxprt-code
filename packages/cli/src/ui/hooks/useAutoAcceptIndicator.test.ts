/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { useAutoAcceptIndicator } from './useAutoAcceptIndicator.js';

import type { Agent } from '@vybestack/llxprt-code-agents';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { Key } from './useKeypress.js';
import { useKeypress } from './useKeypress.js';
import { MessageType } from '../types.js';

vi.mock('./useKeypress.js');

interface AgentStub {
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(value: ApprovalMode) => void>;
}

type UseKeypressHandler = (key: Key) => void;

describe('useAutoAcceptIndicator', () => {
  let agentStub: AgentStub;
  let capturedUseKeypressHandler: UseKeypressHandler;

  beforeEach(() => {
    vi.resetAllMocks();

    const getApprovalModeMock = vi.fn();
    const setApprovalModeMock = vi.fn();

    setApprovalModeMock.mockImplementation((value: ApprovalMode) => {
      getApprovalModeMock.mockReturnValue(value);
    });

    agentStub = {
      getApprovalMode: getApprovalModeMock,
      setApprovalMode: setApprovalModeMock,
    };

    vi.mocked(useKeypress).mockImplementation(
      (handler: UseKeypressHandler, _options) => {
        capturedUseKeypressHandler = handler;
        return { refresh: () => {} };
      },
    );
  });

  it('should initialize with ApprovalMode.AUTO_EDIT if agent.getApprovalMode returns ApprovalMode.AUTO_EDIT', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.AUTO_EDIT);
    const { result } = renderHook(() =>
      useAutoAcceptIndicator({
        agent: agentStub as unknown as Agent,
        addItem: vi.fn(),
      }),
    );
    expect(result.current).toBe(ApprovalMode.AUTO_EDIT);
    expect(agentStub.getApprovalMode).toHaveBeenCalledTimes(1);
  });

  it('should initialize with ApprovalMode.DEFAULT if agent.getApprovalMode returns ApprovalMode.DEFAULT', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
    const { result } = renderHook(() =>
      useAutoAcceptIndicator({
        agent: agentStub as unknown as Agent,
        addItem: vi.fn(),
      }),
    );
    expect(result.current).toBe(ApprovalMode.DEFAULT);
    expect(agentStub.getApprovalMode).toHaveBeenCalledTimes(1);
  });

  it('should initialize with ApprovalMode.YOLO if agent.getApprovalMode returns ApprovalMode.YOLO', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);
    const { result } = renderHook(() =>
      useAutoAcceptIndicator({
        agent: agentStub as unknown as Agent,
        addItem: vi.fn(),
      }),
    );
    expect(result.current).toBe(ApprovalMode.YOLO);
    expect(agentStub.getApprovalMode).toHaveBeenCalledTimes(1);
  });

  it('should toggle the indicator and update the agent when Shift+Tab or Ctrl+Y is pressed', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
    const { result } = renderHook(() =>
      useAutoAcceptIndicator({
        agent: agentStub as unknown as Agent,
        addItem: vi.fn(),
      }),
    );
    expect(result.current).toBe(ApprovalMode.DEFAULT);

    act(() => {
      capturedUseKeypressHandler({
        name: 'tab',
        shift: true,
      } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.AUTO_EDIT,
    );
    expect(result.current).toBe(ApprovalMode.AUTO_EDIT);

    act(() => {
      capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.YOLO);
    expect(result.current).toBe(ApprovalMode.YOLO);

    act(() => {
      capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.DEFAULT,
    );
    expect(result.current).toBe(ApprovalMode.DEFAULT);

    act(() => {
      capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.YOLO);
    expect(result.current).toBe(ApprovalMode.YOLO);

    act(() => {
      capturedUseKeypressHandler({
        name: 'tab',
        shift: true,
      } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.AUTO_EDIT,
    );
    expect(result.current).toBe(ApprovalMode.AUTO_EDIT);

    act(() => {
      capturedUseKeypressHandler({
        name: 'tab',
        shift: true,
      } as Key);
    });
    expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.DEFAULT,
    );
    expect(result.current).toBe(ApprovalMode.DEFAULT);
  });

  it('should not toggle if only one key or other keys combinations are pressed', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
    renderHook(() =>
      useAutoAcceptIndicator({
        agent: agentStub as unknown as Agent,
        addItem: vi.fn(),
      }),
    );

    act(() => {
      capturedUseKeypressHandler({
        name: 'tab',
        shift: false,
      } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({
        name: 'unknown',
        shift: true,
      } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({
        name: 'a',
        shift: false,
        ctrl: false,
      } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({ name: 'y', ctrl: false } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({ name: 'a', ctrl: true } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({ name: 'y', shift: true } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();

    act(() => {
      capturedUseKeypressHandler({
        name: 'a',
        ctrl: true,
        shift: true,
      } as Key);
    });
    expect(agentStub.setApprovalMode).not.toHaveBeenCalled();
  });

  it('should update indicator when the agent value changes externally (useEffect dependency)', () => {
    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
    const { result, rerender } = renderHook(
      (props: { agent: Agent; addItem: () => void }) =>
        useAutoAcceptIndicator(props),
      {
        initialProps: {
          agent: agentStub as unknown as Agent,
          addItem: vi.fn(),
        },
      },
    );
    expect(result.current).toBe(ApprovalMode.DEFAULT);

    agentStub.getApprovalMode.mockReturnValue(ApprovalMode.AUTO_EDIT);

    rerender({
      agent: agentStub as unknown as Agent,
      addItem: vi.fn(),
    });
    // Observable behavior: after the agent's reported mode changes and the
    // hook re-renders, the indicator reflects the new mode. The exact number
    // of getApprovalMode reads is an implementation detail (React render/effect
    // timing) and is not asserted here.
    expect(result.current).toBe(ApprovalMode.AUTO_EDIT);
  });

  describe('when setApprovalMode throws (e.g. untrusted folder)', () => {
    beforeEach(() => {
      agentStub.setApprovalMode.mockImplementation(() => {
        throw new Error(
          'Cannot enable privileged approval modes in an untrusted folder.',
        );
      });
    });

    it('should report the error via addItem when Ctrl+Y is pressed', () => {
      agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
      const mockAddItem = vi.fn();
      const { result } = renderHook(() =>
        useAutoAcceptIndicator({
          agent: agentStub as unknown as Agent,
          addItem: mockAddItem,
        }),
      );

      expect(result.current).toBe(ApprovalMode.DEFAULT);

      act(() => {
        capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
      });

      expect(agentStub.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.YOLO);
      // Assert the full payload: an INFO message with the exact untrusted-folder
      // error text and a numeric timestamp, not just that addItem was called.
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Cannot enable privileged approval modes in an untrusted folder.',
        },
        expect.any(Number),
      );
      // The underlying agent value was not changed (still DEFAULT).
      expect(agentStub.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });

    it('should report the error via addItem when Shift+Tab is pressed', () => {
      agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
      const mockAddItem = vi.fn();
      const { result } = renderHook(() =>
        useAutoAcceptIndicator({
          agent: agentStub as unknown as Agent,
          addItem: mockAddItem,
        }),
      );

      expect(result.current).toBe(ApprovalMode.DEFAULT);

      act(() => {
        capturedUseKeypressHandler({
          name: 'tab',
          shift: true,
        } as Key);
      });

      expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
        ApprovalMode.AUTO_EDIT,
      );
      // Assert the full payload: an INFO message with the exact untrusted-folder
      // error text and a numeric timestamp, not just that addItem was called.
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Cannot enable privileged approval modes in an untrusted folder.',
        },
        expect.any(Number),
      );
      expect(agentStub.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });

    it('should still disable YOLO mode when Ctrl+Y is pressed (downgrade does not throw)', () => {
      // Downgrade from YOLO -> DEFAULT must not throw: restore the default
      // implementation for this scenario so the toggle settles.
      agentStub.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);
      agentStub.setApprovalMode.mockImplementation((value: ApprovalMode) => {
        agentStub.getApprovalMode.mockReturnValue(value);
      });
      const mockAddItem = vi.fn();
      renderHook(() =>
        useAutoAcceptIndicator({
          agent: agentStub as unknown as Agent,
          addItem: mockAddItem,
        }),
      );

      act(() => {
        capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
      });

      expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
        ApprovalMode.DEFAULT,
      );
      expect(agentStub.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      // A successful downgrade produces no error/warning message.
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it('should still disable AUTO_EDIT mode when Shift+Tab is pressed (downgrade does not throw)', () => {
      agentStub.getApprovalMode.mockReturnValue(ApprovalMode.AUTO_EDIT);
      agentStub.setApprovalMode.mockImplementation((value: ApprovalMode) => {
        agentStub.getApprovalMode.mockReturnValue(value);
      });
      const mockAddItem = vi.fn();
      renderHook(() =>
        useAutoAcceptIndicator({
          agent: agentStub as unknown as Agent,
          addItem: mockAddItem,
        }),
      );

      act(() => {
        capturedUseKeypressHandler({
          name: 'tab',
          shift: true,
        } as Key);
      });

      expect(agentStub.setApprovalMode).toHaveBeenCalledWith(
        ApprovalMode.DEFAULT,
      );
      expect(agentStub.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      // A successful downgrade produces no error/warning message.
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it('should show a warning via addItem for both privileged-mode attempts', () => {
      const errorMessage =
        'Cannot enable privileged approval modes in an untrusted folder.';
      agentStub.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
      agentStub.setApprovalMode.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const mockAddItem = vi.fn();
      renderHook(() =>
        useAutoAcceptIndicator({
          agent: agentStub as unknown as Agent,
          addItem: mockAddItem,
        }),
      );

      // Try to enable YOLO mode
      act(() => {
        capturedUseKeypressHandler({ name: 'y', ctrl: true } as Key);
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: errorMessage,
        },
        expect.any(Number),
      );

      // Try to enable AUTO_EDIT mode
      act(() => {
        capturedUseKeypressHandler({
          name: 'tab',
          shift: true,
        } as Key);
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: errorMessage,
        },
        expect.any(Number),
      );

      expect(mockAddItem).toHaveBeenCalledTimes(2);
    });
  });
});
