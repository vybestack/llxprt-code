/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  getResponseText,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
} from '@google/genai';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { isSlashCommand } from '../utils/commandUtils.js';

export const PROMPT_COMPLETION_MIN_LENGTH = 5;
export const PROMPT_COMPLETION_DEBOUNCE_MS = 250;

export interface PromptCompletion {
  text: string;
  isLoading: boolean;
  isActive: boolean;
  accept: () => void;
  clear: () => void;
  markSelected: (selectedText: string) => void;
}

export interface UsePromptCompletionOptions {
  buffer: TextBuffer;
  config?: Config;
  enabled: boolean;
}

interface PromptCompletionState {
  ghostText: string;
  isLoadingGhostText: boolean;
  clearGhostText: () => void;
  acceptGhostText: () => void;
  markSuggestionSelected: (selectedText: string) => void;
  lastSelectedTextRef: MutableRefObject<string>;
  setGhostText: Dispatch<SetStateAction<string>>;
  setIsLoadingGhostText: Dispatch<SetStateAction<boolean>>;
}

interface PromptSuggestionParams {
  buffer: TextBuffer;
  config: Config | undefined;
  isPromptCompletionEnabled: boolean;
  clearGhostText: () => void;
  setGhostText: Dispatch<SetStateAction<string>>;
  setIsLoadingGhostText: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  lastRequestedTextRef: MutableRefObject<string>;
}

type GeminiClient = ReturnType<Config['getGeminiClient']>;

function shouldSkipPromptCompletion(
  trimmedText: string,
  isPromptCompletionEnabled: boolean,
  geminiClient: GeminiClient | undefined,
): boolean {
  return (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    trimmedText.length < PROMPT_COMPLETION_MIN_LENGTH ||
    !geminiClient ||
    isSlashCommand(trimmedText) ||
    trimmedText.includes('@') ||
    !isPromptCompletionEnabled
  );
}

function buildPromptCompletionRequest(trimmedText: string): {
  contents: Content[];
  generationConfig: GenerateContentConfig;
} {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a professional prompt engineering assistant. Complete the user's partial prompt with expert precision and clarity. User's input: "${trimmedText}" Continue this prompt by adding specific, actionable details that align with the user's intent. Focus on: clear, precise language; structured requirements; professional terminology; measurable outcomes. Length Guidelines: Keep suggestions concise (ideally 10-20 characters); prioritize brevity while maintaining clarity; use essential keywords only; avoid redundant phrases. Start your response with the exact user text ("${trimmedText}") followed by your completion. Provide practical, implementation-focused suggestions rather than creative interpretations. Format: Plain text only. Single completion. Match the user's language. Emphasize conciseness over elaboration.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 16000,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };
}

function deriveSuggestionText(
  response: GenerateContentResponse,
  trimmedText: string,
): string {
  const responseText = getResponseText(response);
  if (!responseText) return '';

  const suggestionText = responseText.trim();
  if (suggestionText.length > 0 && suggestionText.startsWith(trimmedText)) {
    return suggestionText;
  }
  return '';
}

async function requestPromptSuggestion(
  geminiClient: NonNullable<GeminiClient>,
  trimmedText: string,
  signal: AbortSignal,
): Promise<string> {
  const { contents, generationConfig } =
    buildPromptCompletionRequest(trimmedText);
  const response = await geminiClient.generateContent(
    contents,
    generationConfig,
    signal,
    DEFAULT_GEMINI_FLASH_LITE_MODEL,
  );
  if (signal.aborted) return '';

  return deriveSuggestionText(response, trimmedText);
}

function isCursorAtBufferEnd(buffer: TextBuffer): boolean {
  const [cursorRow, cursorCol] = buffer.cursor;
  if (cursorRow !== buffer.lines.length - 1) return false;

  const lastLine = buffer.lines[cursorRow] || '';
  return cursorCol === lastLine.length;
}

function isCompletionActive(
  buffer: TextBuffer,
  isPromptCompletionEnabled: boolean,
): boolean {
  if (!isPromptCompletionEnabled || !isCursorAtBufferEnd(buffer)) return false;

  const trimmedText = buffer.text.trim();
  return (
    trimmedText.length >= PROMPT_COMPLETION_MIN_LENGTH &&
    !isSlashCommand(trimmedText) &&
    !trimmedText.includes('@')
  );
}

function usePromptCompletionState(buffer: TextBuffer): PromptCompletionState {
  const [ghostText, setGhostText] = useState<string>('');
  const [isLoadingGhostText, setIsLoadingGhostText] = useState<boolean>(false);
  const [, setJustSelectedSuggestion] = useState<boolean>(false);
  const lastSelectedTextRef = useRef<string>('');

  const clearGhostText = useCallback(() => {
    setGhostText('');
    setIsLoadingGhostText(false);
  }, []);

  const acceptGhostText = useCallback(() => {
    if (ghostText && ghostText.length > buffer.text.length) {
      buffer.setText(ghostText);
      setGhostText('');
      setJustSelectedSuggestion(true);
      lastSelectedTextRef.current = ghostText;
    }
  }, [ghostText, buffer]);

  const markSuggestionSelected = useCallback((selectedText: string) => {
    setJustSelectedSuggestion(true);
    lastSelectedTextRef.current = selectedText;
  }, []);

  return {
    ghostText,
    isLoadingGhostText,
    clearGhostText,
    acceptGhostText,
    markSuggestionSelected,
    lastSelectedTextRef,
    setGhostText,
    setIsLoadingGhostText,
  };
}

function usePromptSuggestionGenerator({
  buffer,
  config,
  isPromptCompletionEnabled,
  clearGhostText,
  setGhostText,
  setIsLoadingGhostText,
  abortControllerRef,
  lastRequestedTextRef,
}: PromptSuggestionParams) {
  return useCallback(async () => {
    const trimmedText = buffer.text.trim();
    const geminiClient = config?.getGeminiClient();

    if (trimmedText === lastRequestedTextRef.current) return;
    abortControllerRef.current?.abort();

    if (
      shouldSkipPromptCompletion(
        trimmedText,
        isPromptCompletionEnabled,
        geminiClient,
      )
    ) {
      clearGhostText();
      lastRequestedTextRef.current = '';
      return;
    }

    if (!geminiClient) return;

    lastRequestedTextRef.current = trimmedText;
    setIsLoadingGhostText(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const suggestionText = await requestPromptSuggestion(
        geminiClient,
        trimmedText,
        signal,
      );
      if (suggestionText.length > 0) setGhostText(suggestionText);
      else clearGhostText();
    } catch (error) {
      if (
        !(
          signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        )
      ) {
        debugLogger.error('prompt completion error:', error);
      }
      clearGhostText();
    } finally {
      if (!signal.aborted) setIsLoadingGhostText(false);
    }
  }, [
    abortControllerRef,
    buffer.text,
    clearGhostText,
    config,
    isPromptCompletionEnabled,
    lastRequestedTextRef,
    setGhostText,
    setIsLoadingGhostText,
  ]);
}

function usePromptCompletionEffects({
  buffer,
  ghostText,
  clearGhostText,
  handlePromptCompletion,
  abortControllerRef,
}: {
  buffer: TextBuffer;
  ghostText: string;
  clearGhostText: () => void;
  handlePromptCompletion: () => void;
  abortControllerRef: MutableRefObject<AbortController | null>;
}) {
  useEffect(() => {
    const timeoutId = setTimeout(
      handlePromptCompletion,
      PROMPT_COMPLETION_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [buffer.text, buffer.cursor, handlePromptCompletion]);

  useEffect(() => {
    const currentText = buffer.text.trim();

    if (ghostText && !isCursorAtBufferEnd(buffer)) {
      clearGhostText();
      return;
    }

    if (
      ghostText &&
      currentText.length > 0 &&
      !ghostText.startsWith(currentText)
    ) {
      clearGhostText();
    }
  }, [buffer, buffer.text, buffer.cursor, ghostText, clearGhostText]);

  useEffect(
    () => () => abortControllerRef.current?.abort(),
    [abortControllerRef],
  );
}

export function usePromptCompletion({
  buffer,
  config,
  enabled,
}: UsePromptCompletionOptions): PromptCompletion {
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRequestedTextRef = useRef<string>('');
  const isPromptCompletionEnabled =
    enabled && (config?.getEnablePromptCompletion() ?? false);
  const state = usePromptCompletionState(buffer);
  const generatePromptSuggestions = usePromptSuggestionGenerator({
    buffer,
    config,
    isPromptCompletionEnabled,
    clearGhostText: state.clearGhostText,
    setGhostText: state.setGhostText,
    setIsLoadingGhostText: state.setIsLoadingGhostText,
    abortControllerRef,
    lastRequestedTextRef,
  });

  const handlePromptCompletion = useCallback(() => {
    if (!isCursorAtBufferEnd(buffer)) {
      state.clearGhostText();
      return;
    }

    const trimmedText = buffer.text.trim();
    if (trimmedText === state.lastSelectedTextRef.current) return;

    state.lastSelectedTextRef.current = '';
    void generatePromptSuggestions();
  }, [buffer, generatePromptSuggestions, state]);

  usePromptCompletionEffects({
    buffer,
    ghostText: state.ghostText,
    clearGhostText: state.clearGhostText,
    handlePromptCompletion,
    abortControllerRef,
  });

  return {
    text: state.ghostText,
    isLoading: state.isLoadingGhostText,
    isActive: isCompletionActive(buffer, isPromptCompletionEnabled),
    accept: state.acceptGhostText,
    clear: state.clearGhostText,
    markSelected: state.markSuggestionSelected,
  };
}
