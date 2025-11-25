/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../semantic-colors.js';
import { interpolateColor } from '../utils/color-utils.js';
import { debugState } from '../utils/debug.js';

export function useAnimatedScrollbar(
  isFocused: boolean,
  scrollBy: (delta: number) => void,
) {
  const [scrollbarColor, setScrollbarColor] = useState(
    theme.ui.gradient?.[0] || theme.ui.comment,
  ); // Default to a gradient color or dark
  const colorRef = useRef(scrollbarColor);
  colorRef.current = scrollbarColor;

  const animationFrame = useRef<NodeJS.Timeout | null>(null);
  const timeout = useRef<NodeJS.Timeout | null>(null);
  const isAnimatingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (isAnimatingRef.current) {
      debugState.debugNumAnimatedComponents--;
      isAnimatingRef.current = false;
    }
    if (animationFrame.current) {
      clearInterval(animationFrame.current);
      animationFrame.current = null;
    }
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = null;
    }
  }, []);

  const flashScrollbar = useCallback(() => {
    cleanup();
    debugState.debugNumAnimatedComponents++;
    isAnimatingRef.current = true;

    const fadeInDuration = 200;
    const visibleDuration = 1000;
    const fadeOutDuration = 300;

    const focusedColor = theme.text.secondary;
    const unfocusedColor = theme.ui.comment; // Use comment color as fallback for dark
    const startColor = colorRef.current;

    if (!focusedColor || !unfocusedColor || !startColor) {
      return;
    }

    // Validate hex format to prevent interpolateColor from throwing
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    if (
      !hexPattern.test(startColor) ||
      !hexPattern.test(focusedColor) ||
      !hexPattern.test(unfocusedColor)
    ) {
      debugState.debugNumAnimatedComponents--;
      isAnimatingRef.current = false;
      return;
    }

    // Phase 1: Fade In
    let start = Date.now();
    const animateFadeIn = () => {
      const elapsed = Date.now() - start;
      const progress = Math.max(0, Math.min(elapsed / fadeInDuration, 1));

      setScrollbarColor(interpolateColor(startColor, focusedColor, progress));

      if (progress === 1) {
        if (animationFrame.current) {
          clearInterval(animationFrame.current);
          animationFrame.current = null;
        }

        // Phase 2: Wait
        timeout.current = setTimeout(() => {
          // Phase 3: Fade Out
          start = Date.now();
          const animateFadeOut = () => {
            const elapsed = Date.now() - start;
            const progress = Math.max(
              0,
              Math.min(elapsed / fadeOutDuration, 1),
            );
            setScrollbarColor(
              interpolateColor(focusedColor, unfocusedColor, progress),
            );

            if (progress === 1) {
              cleanup();
            }
          };

          animationFrame.current = setInterval(animateFadeOut, 33);
        }, visibleDuration);
      }
    };

    animationFrame.current = setInterval(animateFadeIn, 33);
  }, [cleanup]);

  const wasFocused = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocused.current) {
      flashScrollbar();
    } else if (!isFocused && wasFocused.current) {
      cleanup();
      const fallbackColor = '#666666'; // Fallback gray if theme color is invalid
      const targetColor = theme.ui.comment;
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;
      setScrollbarColor(
        targetColor && hexPattern.test(targetColor)
          ? targetColor
          : fallbackColor,
      );
    }
    wasFocused.current = isFocused;
    return cleanup;
  }, [isFocused, flashScrollbar, cleanup]);

  const scrollByWithAnimation = useCallback(
    (delta: number) => {
      scrollBy(delta);
      flashScrollbar();
    },
    [scrollBy, flashScrollbar],
  );

  return { scrollbarColor, flashScrollbar, scrollByWithAnimation };
}
