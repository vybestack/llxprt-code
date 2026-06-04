/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useStdin } from 'ink';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { ESC } from '../utils/input.js';
import {
  isIncompleteMouseSequence,
  parseMouseEvent,
  type MouseEvent,
  type MouseEventName,
  type MouseHandler,
} from '../utils/mouse.js';

export type { MouseEvent, MouseEventName, MouseHandler };

const MAX_MOUSE_BUFFER_SIZE = 4096;

interface MouseContextValue {
  subscribe: (handler: MouseHandler) => void;
  unsubscribe: (handler: MouseHandler) => void;
}

const MouseContext = createContext<MouseContextValue | undefined>(undefined);

export function useMouseContext() {
  const context = useContext(MouseContext);
  if (!context) {
    throw new Error('useMouseContext must be used within a MouseProvider');
  }
  return context;
}

export function useMouse(handler: MouseHandler, { isActive = true } = {}) {
  const { subscribe, unsubscribe } = useMouseContext();

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    subscribe(handler);
    return () => unsubscribe(handler);
  }, [isActive, handler, subscribe, unsubscribe]);
}

export function MouseProvider({
  children,
  mouseEventsEnabled,
}: {
  children: React.ReactNode;
  mouseEventsEnabled?: boolean;
}) {
  const { stdin } = useStdin();
  const subscribers = useRef<Set<MouseHandler>>(new Set()).current;

  const subscribe = useCallback(
    (handler: MouseHandler) => {
      subscribers.add(handler);
    },
    [subscribers],
  );

  const unsubscribe = useCallback(
    (handler: MouseHandler) => {
      subscribers.delete(handler);
    },
    [subscribers],
  );

  useEffect(() => {
    if (mouseEventsEnabled !== true) {
      return undefined;
    }

    let mouseBuffer = '';

    const broadcast = (event: MouseEvent) => {
      for (const handler of subscribers) {
        handler(event);
      }
    };

    const handleData = (data: Buffer | string) => {
      mouseBuffer += typeof data === 'string' ? data : data.toString('utf-8');

      // Safety cap to prevent infinite buffer growth on garbage
      if (mouseBuffer.length > MAX_MOUSE_BUFFER_SIZE) {
        mouseBuffer = mouseBuffer.slice(-MAX_MOUSE_BUFFER_SIZE);
      }

      while (mouseBuffer.length > 0) {
        const parsed = parseMouseEvent(mouseBuffer);

        if (parsed) {
          broadcast(parsed.event);
          mouseBuffer = mouseBuffer.slice(parsed.length);
        } else if (isIncompleteMouseSequence(mouseBuffer)) {
          // Wait for more data - exit loop
          break;
        } else {
          // Not a valid sequence at start, and not waiting for more data.
          // Discard garbage until next possible sequence start.
          const nextEsc = mouseBuffer.indexOf(ESC, 1);
          mouseBuffer = nextEsc !== -1 ? mouseBuffer.slice(nextEsc) : '';
        }
      }
    };

    stdin.on('data', handleData);

    return () => {
      stdin.removeListener('data', handleData);
    };
  }, [stdin, mouseEventsEnabled, subscribers]);

  const contextValue = useMemo(
    () => ({ subscribe, unsubscribe }),
    [subscribe, unsubscribe],
  );

  return (
    <MouseContext.Provider value={contextValue}>
      {children}
    </MouseContext.Provider>
  );
}
