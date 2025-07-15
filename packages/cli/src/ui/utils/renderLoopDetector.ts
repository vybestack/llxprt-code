/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useEffect } from 'react';

interface RenderInfo {
  count: number;
  lastRenderTime: number;
  renderTimes: number[];
}

const renderCounts = new Map<string, RenderInfo>();
const RENDER_THRESHOLD = 50; // Consider it a loop if rendered more than 50 times
const TIME_WINDOW = 1000; // Within 1 second
const RAPID_RENDER_THRESHOLD = 10; // More than 10 renders
const RAPID_TIME_WINDOW = 100; // Within 100ms

/**
 * Hook to detect potential render loops in development.
 * Logs warnings when components render too frequently.
 *
 * @param componentName Name of the component for debugging
 * @param props Optional props to log when loop detected
 *
 * @example
 * ```typescript
 * function MyComponent({ value }: Props) {
 *   useRenderLoopDetector('MyComponent', { value });
 *   // ... rest of component
 * }
 * ```
 */
export function useRenderLoopDetector(
  componentName: string,
  props?: Record<string, unknown>,
) {
  const renderCountRef = useRef(0);
  const renderTimesRef = useRef<number[]>([]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const now = Date.now();
    renderCountRef.current += 1;
    renderTimesRef.current.push(now);

    // Update global tracking
    const info = renderCounts.get(componentName) || {
      count: 0,
      lastRenderTime: now,
      renderTimes: [],
    };

    info.count += 1;
    info.lastRenderTime = now;
    info.renderTimes.push(now);

    // Keep only recent render times
    const cutoffTime = now - TIME_WINDOW;
    info.renderTimes = info.renderTimes.filter((time) => time > cutoffTime);

    renderCounts.set(componentName, info);

    // Check for render loops
    const recentRenders = info.renderTimes.length;
    const rapidRenders = info.renderTimes.filter(
      (time) => time > now - RAPID_TIME_WINDOW,
    ).length;

    if (rapidRenders > RAPID_RENDER_THRESHOLD) {
      console.error(
        `🚨 RENDER LOOP DETECTED: ${componentName} rendered ${rapidRenders} times in ${RAPID_TIME_WINDOW}ms!`,
        '\nProps:',
        props,
        '\nTotal renders:',
        info.count,
        '\nConsider checking:',
        '\n- useEffect dependencies',
        '\n- State updates during render',
        '\n- Unmemoized props/callbacks',
        '\n- Inline object/array creation',
      );
    } else if (recentRenders > RENDER_THRESHOLD) {
      console.warn(
        `⚠️ High render count: ${componentName} rendered ${recentRenders} times in ${TIME_WINDOW}ms`,
        '\nProps:',
        props,
        '\nTotal renders:',
        info.count,
      );
    }

    // Cleanup old entries periodically
    if (renderCounts.size > 100) {
      const oldestAllowed = now - 60000; // 1 minute
      for (const [name, data] of renderCounts.entries()) {
        if (data.lastRenderTime < oldestAllowed) {
          renderCounts.delete(name);
        }
      }
    }
  });
}

/**
 * Hook to track which props are causing re-renders.
 * Logs when props change between renders.
 *
 * @param componentName Name of the component
 * @param props Props to track
 *
 * @example
 * ```typescript
 * function MyComponent({ value, onChange }: Props) {
 *   useWhyDidYouRender('MyComponent', { value, onChange });
 *   // ... rest of component
 * }
 * ```
 */
export function useWhyDidYouRender(
  componentName: string,
  props: Record<string, unknown>,
) {
  const previousProps = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    if (previousProps.current) {
      const allKeys = new Set([
        ...Object.keys(previousProps.current),
        ...Object.keys(props),
      ]);

      const changedProps: Record<string, { from: unknown; to: unknown }> = {};

      for (const key of allKeys) {
        const prevValue = previousProps.current[key];
        const currentValue = props[key];

        if (!Object.is(prevValue, currentValue)) {
          changedProps[key] = {
            from: prevValue,
            to: currentValue,
          };
        }
      }

      if (Object.keys(changedProps).length > 0) {
        console.log(
          `🔍 ${componentName} re-rendered due to prop changes:`,
          changedProps,
        );
      }
    }

    previousProps.current = props;
  });
}

/**
 * Get render statistics for all tracked components.
 * Useful for debugging performance issues.
 *
 * @returns Object with render counts by component
 */
export function getRenderStats(): Record<
  string,
  { count: number; recentCount: number }
> {
  const stats: Record<string, { count: number; recentCount: number }> = {};
  const now = Date.now();

  for (const [name, info] of renderCounts.entries()) {
    const recentCount = info.renderTimes.filter(
      (time) => time > now - TIME_WINDOW,
    ).length;

    stats[name] = {
      count: info.count,
      recentCount,
    };
  }

  return stats;
}

/**
 * Reset all render statistics.
 * Useful when starting a new debugging session.
 */
export function resetRenderStats() {
  renderCounts.clear();
}

// Export for console debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  // Use global object for Node.js/CLI environment
  const globalObj = typeof globalThis !== 'undefined' ? globalThis : global;
  (globalObj as Record<string, unknown>).__getRenderStats = getRenderStats;
  (globalObj as Record<string, unknown>).__resetRenderStats = resetRenderStats;
}
