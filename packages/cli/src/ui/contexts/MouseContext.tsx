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
import { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  isIncompleteMouseSequence,
  parseMouseEvent,
  type MouseEvent,
  type MouseHandler,
} from '../utils/mouse.js';
import { ESC } from '../utils/input.js';

export type { MouseEvent } from '../utils/mouse.js';
export type { MouseHandler } from '../utils/mouse.js';

const mouseLogger = new DebugLogger('llxprt:ui:mouse');
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

export function MouseProvider({
  children,
  mouseEventsEnabled,
  debugKeystrokeLogging,
}: {
  children: React.ReactNode;
  mouseEventsEnabled?: boolean;
  debugKeystrokeLogging?: boolean;
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
    if (!mouseEventsEnabled) {
      return;
    }

    let mouseBuffer = '';

    const broadcast = (event: MouseEvent) => {
      for (const handler of subscribers) {
        handler(event);
      }
    };

    const handleData = (data: Buffer | string) => {
      mouseBuffer += typeof data === 'string' ? data : data.toString('utf8');

      if (mouseBuffer.length > MAX_MOUSE_BUFFER_SIZE) {
        mouseBuffer = mouseBuffer.slice(-MAX_MOUSE_BUFFER_SIZE);
      }

      while (mouseBuffer.length > 0) {
        const parsed = parseMouseEvent(mouseBuffer);

        if (parsed) {
          if (debugKeystrokeLogging && mouseLogger.enabled) {
            mouseLogger.debug(
              () =>
                `[DEBUG] Mouse event parsed: ${JSON.stringify(parsed.event)}`,
            );
          }
          broadcast(parsed.event);
          mouseBuffer = mouseBuffer.slice(parsed.length);
          continue;
        }

        if (isIncompleteMouseSequence(mouseBuffer)) {
          break;
        }

        const nextEsc = mouseBuffer.indexOf(ESC, 1);
        if (nextEsc !== -1) {
          mouseBuffer = mouseBuffer.slice(nextEsc);
        } else {
          mouseBuffer = '';
          break;
        }
      }
    };

    stdin.on('data', handleData);
    return () => {
      stdin.removeListener('data', handleData);
    };
  }, [stdin, mouseEventsEnabled, subscribers, debugKeystrokeLogging]);

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
