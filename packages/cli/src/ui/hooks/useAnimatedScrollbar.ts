/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../semantic-colors.js';
import { interpolateColor } from '../themes/color-utils.js';
import { debugState } from '../debug.js';

const ANIMATION_INTERVAL_MS = 33;
const FADE_IN_DURATION_MS = 200;
const VISIBLE_DURATION_MS = 1000;
const FADE_OUT_DURATION_MS = 300;

function createFadeOutAnimator(
  focusedColor: string,
  unfocusedColor: string,
  setScrollbarColor: (color: string) => void,
  cleanup: () => void,
) {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    const progress = Math.max(0, Math.min(elapsed / FADE_OUT_DURATION_MS, 1));
    setScrollbarColor(interpolateColor(focusedColor, unfocusedColor, progress));
    if (progress === 1) {
      cleanup();
    }
  };
}

function startFadeOut(
  focusedColor: string,
  unfocusedColor: string,
  setScrollbarColor: (color: string) => void,
  cleanup: () => void,
  animationFrame: React.MutableRefObject<NodeJS.Timeout | null>,
  timeout: React.MutableRefObject<NodeJS.Timeout | null>,
) {
  const animateFadeOut = createFadeOutAnimator(
    focusedColor,
    unfocusedColor,
    setScrollbarColor,
    cleanup,
  );
  timeout.current = setTimeout(() => {
    animationFrame.current = setInterval(animateFadeOut, ANIMATION_INTERVAL_MS);
  }, VISIBLE_DURATION_MS);
}

function createFadeInAnimator(
  startColor: string,
  focusedColor: string,
  unfocusedColor: string,
  setScrollbarColor: (color: string) => void,
  cleanup: () => void,
  animationFrame: React.MutableRefObject<NodeJS.Timeout | null>,
  timeout: React.MutableRefObject<NodeJS.Timeout | null>,
) {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    const progress = Math.max(0, Math.min(elapsed / FADE_IN_DURATION_MS, 1));
    setScrollbarColor(interpolateColor(startColor, focusedColor, progress));

    if (progress === 1) {
      if (animationFrame.current) {
        clearInterval(animationFrame.current);
        animationFrame.current = null;
      }
      startFadeOut(
        focusedColor,
        unfocusedColor,
        setScrollbarColor,
        cleanup,
        animationFrame,
        timeout,
      );
    }
  };
}

export function useAnimatedScrollbar(
  isFocused: boolean,
  scrollBy: (delta: number) => void,
) {
  const [scrollbarColor, setScrollbarColor] = useState(theme.ui.dark);
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

    const focusedColor = theme.text.secondary;
    const unfocusedColor = theme.ui.dark;
    const startColor = colorRef.current;

    if (!focusedColor || !unfocusedColor) {
      return;
    }

    debugState.debugNumAnimatedComponents++;
    isAnimatingRef.current = true;

    const animateFadeIn = createFadeInAnimator(
      startColor,
      focusedColor,
      unfocusedColor,
      setScrollbarColor,
      cleanup,
      animationFrame,
      timeout,
    );

    animationFrame.current = setInterval(animateFadeIn, ANIMATION_INTERVAL_MS);
  }, [cleanup]);

  const wasFocused = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocused.current) {
      flashScrollbar();
    } else if (!isFocused && wasFocused.current) {
      cleanup();
      setScrollbarColor(theme.ui.dark);
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
