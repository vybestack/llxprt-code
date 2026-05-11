/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { logicalPosToOffset } from '../components/shared/buffer-operations.js';
import { isSlashCommand } from '../utils/commandUtils.js';
import { toCodePoints } from '../utils/textUtils.js';
import { useCompletion } from './useCompletion.js';
import type { SlashCommandCompletionContext } from './slashCompletionTypes.js';
import {
  handleCompletionEffect,
  type StateRefs,
  type AllSetters,
} from './slashCompletionEffect.js';

export interface UseSlashCompletionReturn {
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  visibleStartIndex: number;
  showSuggestions: boolean;
  isLoadingSuggestions: boolean;
  isPerfectMatch: boolean;
  activeHint: string;
  setActiveSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
  setShowSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  resetCompletionState: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  handleAutocomplete: (indexToUse: number) => string | undefined;
  getCommandFromSuggestion: (suggestionIndex: number) => SlashCommand | null;
  isArgumentCompletion: boolean;
  leafCommand: SlashCommand | null;
}

type RuntimeExtensionConfig = Partial<Pick<Config, 'isExtensionEnabled'>>;
type RuntimeCommandContext = Omit<CommandContext, 'services'> & {
  services?: { config?: RuntimeExtensionConfig | null };
};

function getExtCfg(
  ctx: CommandContext,
): RuntimeExtensionConfig | null | undefined {
  return (ctx as RuntimeCommandContext).services?.config;
}

function computeCmdIdx(
  row: number,
  col: number,
  lines: readonly string[],
): number {
  const line = lines[row] || '';
  if (row === 0 && isSlashCommand(line.trim())) {
    const i = line.indexOf('/');
    return i === 0 ? i : -1;
  }
  const cps = toCodePoints(line);
  for (let i = col - 1; i >= 0; i--) {
    if (cps[i] === ' ') {
      let bc = 0;
      for (let j = i - 1; j >= 0 && cps[j] === '\\'; j--) {
        bc++;
      }
      if (bc % 2 === 0) {
        return -1;
      }
    } else if (cps[i] === '@') {
      return i;
    }
  }
  return -1;
}

function applyAutocomplete(
  s: string,
  buf: TextBuffer,
  row: number,
  idx: number,
  start: number,
  end: number,
): string | undefined {
  const isSlash = (buf.lines[row] || '')[idx] === '/';
  let t = s;
  const l = buf.lines[row] || '';
  if (isSlash && start === end && start > idx + 1 && l[start - 1] !== ' ') {
    t = ' ' + t;
  }
  t += ' ';
  const so = logicalPosToOffset(buf.lines, row, start);
  const eo = logicalPosToOffset(buf.lines, row, end);
  const r = buf.text.substring(0, so) + t + buf.text.substring(eo);
  buf.replaceRangeByOffset(so, eo, t);
  return r;
}

function useStateRefs(): StateRefs {
  const seqRef = useRef<number>(0);
  const start = useRef(-1);
  const end = useRef(-1);
  const prev = useRef<string>('');
  const ctxRef = useRef<{
    isArgumentCompletion: boolean;
    leafCommand: SlashCommand | null;
    commandMap: Map<string, SlashCommand>;
  }>({
    isArgumentCompletion: false,
    leafCommand: null,
    commandMap: new Map<string, SlashCommand>(),
  });
  return {
    completionSequenceRef: seqRef,
    completionStart: start,
    completionEnd: end,
    previousInput: prev,
    slashCompletionContextRef: ctxRef,
  };
}

function useMemoInput(
  cmdIdx: number,
  row: number,
  col: number,
  lines: readonly string[],
) {
  return useMemo(() => {
    if (cmdIdx === -1) return null;
    return { line: lines[row] || '', commandIndex: cmdIdx, cursorCol: col };
  }, [lines, row, cmdIdx, col]);
}

function useSetupEffect(
  buf: TextBuffer,
  cmds: readonly SlashCommand[],
  ctx: CommandContext,
  cfg: Config | undefined,
  dirs: readonly string[],
  cwd: string,
  reverseSearchActive: boolean,
  refs: StateRefs,
  cmdIdx: number,
  col: number,
  extCfg: RuntimeExtensionConfig | null | undefined,
  mi: { line: string; commandIndex: number; cursorCol: number } | null,
  resetCompletionState: () => void,
  setActiveHint: (h: string) => void,
  setters: AllSetters,
): void {
  useEffect(
    () =>
      handleCompletionEffect(
        mi,
        cmdIdx,
        col,
        cmds,
        extCfg,
        ctx,
        cfg,
        dirs,
        cwd,
        refs,
        reverseSearchActive,
        resetCompletionState,
        setActiveHint,
        setters,
      ),
    [
      mi,
      cmdIdx,
      col,
      cmds,
      extCfg,
      ctx,
      cfg,
      dirs,
      cwd,
      refs,
      reverseSearchActive,
      resetCompletionState,
      setActiveHint,
      setters,
    ],
  );
}

function useSlashCompletionSetup(
  buffer: TextBuffer,
  slashCommands: readonly SlashCommand[],
  commandContext: CommandContext,
  config: Config | undefined,
  dirs: readonly string[],
  cwd: string,
  reverseSearchActive: boolean,
  resetCompletionState: () => void,
  setSuggestions: (s: Suggestion[]) => void,
  setShowSuggestions: (show: boolean) => void,
  setActiveSuggestionIndex: (idx: number) => void,
  setIsLoadingSuggestions: (l: boolean) => void,
  setIsPerfectMatch: (p: boolean) => void,
  setVisibleStartIndex: (i: number) => void,
  setActiveHint: (h: string) => void,
) {
  const refs = useStateRefs();
  const [cursorRow, cursorCol] = buffer.cursor;
  const extCfg = getExtCfg(commandContext);
  const cmdIdx = useMemo(
    () => computeCmdIdx(cursorRow, cursorCol, buffer.lines),
    [cursorRow, cursorCol, buffer.lines],
  );
  const mi = useMemoInput(cmdIdx, cursorRow, cursorCol, buffer.lines);

  const setCtx = useCallback(
    (v: SlashCommandCompletionContext) => {
      refs.slashCompletionContextRef.current = {
        isArgumentCompletion: v.isArgumentCompletion,
        leafCommand: v.leafCommand,
        commandMap: v.commandMap ?? new Map<string, SlashCommand>(),
      };
      refs.completionStart.current = v.completionStart;
      refs.completionEnd.current = v.completionEnd;
    },
    [refs],
  );

  const setters = useMemo<AllSetters>(
    () => ({
      setSuggestions,
      setShowSuggestions,
      setActiveSuggestionIndex,
      setActiveHint,
      setIsPerfectMatch,
      setIsLoadingSuggestions,
      setSlashCompletionContext: setCtx,
      setVisibleStartIndex,
    }),
    [
      setSuggestions,
      setShowSuggestions,
      setActiveSuggestionIndex,
      setActiveHint,
      setIsPerfectMatch,
      setIsLoadingSuggestions,
      setCtx,
      setVisibleStartIndex,
    ],
  );

  useSetupEffect(
    buffer,
    slashCommands,
    commandContext,
    config,
    dirs,
    cwd,
    reverseSearchActive,
    refs,
    cmdIdx,
    cursorCol,
    extCfg,
    mi,
    resetCompletionState,
    setActiveHint,
    setters,
  );

  return { cmdIdx, refs, cursorRow, setters };
}

function useAutocompleteCallback(
  suggestions: Suggestion[],
  buffer: TextBuffer,
  cursorRow: number,
  cmdIdx: number,
  refs: StateRefs,
  setSuggestions: (s: Suggestion[]) => void,
  setShowSuggestions: (show: boolean) => void,
  setActiveSuggestionIndex: (idx: number) => void,
  setVisibleStartIndex: (i: number) => void,
  setActiveHint: (h: string) => void,
  setIsLoadingSuggestions: (l: boolean) => void,
): (i: number) => string | undefined {
  return useCallback(
    (i: number): string | undefined => {
      if (i < 0 || i >= suggestions.length) return undefined;
      if (
        refs.completionStart.current === -1 ||
        refs.completionEnd.current === -1
      )
        return undefined;
      const r = applyAutocomplete(
        suggestions[i].value,
        buffer,
        cursorRow,
        cmdIdx,
        refs.completionStart.current,
        refs.completionEnd.current,
      );
      if (r !== undefined) {
        setSuggestions([]);
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        setVisibleStartIndex(0);
        setActiveHint('');
        setIsLoadingSuggestions(false);
      }
      return r;
    },
    [
      cursorRow,
      buffer,
      suggestions,
      cmdIdx,
      setSuggestions,
      setShowSuggestions,
      setActiveSuggestionIndex,
      setVisibleStartIndex,
      setActiveHint,
      setIsLoadingSuggestions,
      refs,
    ],
  );
}

function useCommandLookup(
  suggestions: Suggestion[],
  refs: StateRefs,
): (suggestionIndex: number) => SlashCommand | null {
  return useCallback(
    (suggestionIndex: number): SlashCommand | null => {
      if (suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
        return null;
      }
      return (
        refs.slashCompletionContextRef.current.commandMap.get(
          suggestions[suggestionIndex].value,
        ) ?? null
      );
    },
    [suggestions, refs],
  );
}

export function useSlashCompletion(
  buffer: TextBuffer,
  dirs: readonly string[],
  cwd: string,
  slashCommands: readonly SlashCommand[],
  commandContext: CommandContext,
  reverseSearchActive: boolean = false,
  config?: Config,
): UseSlashCompletionReturn {
  const {
    suggestions,
    activeSuggestionIndex,
    visibleStartIndex,
    showSuggestions,
    isLoadingSuggestions,
    isPerfectMatch,
    setSuggestions,
    setShowSuggestions,
    setActiveSuggestionIndex,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
    setVisibleStartIndex,
    resetCompletionState,
    navigateUp,
    navigateDown,
  } = useCompletion();

  const [activeHint, setActiveHint] = React.useState<string>('');

  const { cmdIdx, refs, cursorRow } = useSlashCompletionSetup(
    buffer,
    slashCommands,
    commandContext,
    config,
    dirs,
    cwd,
    reverseSearchActive,
    resetCompletionState,
    setSuggestions,
    setShowSuggestions,
    setActiveSuggestionIndex,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
    setVisibleStartIndex,
    setActiveHint,
  );

  const handleAutocomplete = useAutocompleteCallback(
    suggestions,
    buffer,
    cursorRow,
    cmdIdx,
    refs,
    setSuggestions,
    setShowSuggestions,
    setActiveSuggestionIndex,
    setVisibleStartIndex,
    setActiveHint,
    setIsLoadingSuggestions,
  );

  const getCommandFromSuggestion = useCommandLookup(suggestions, refs);

  return {
    suggestions,
    activeSuggestionIndex,
    visibleStartIndex,
    showSuggestions,
    isLoadingSuggestions,
    isPerfectMatch,
    activeHint,
    setActiveSuggestionIndex,
    setShowSuggestions,
    resetCompletionState,
    navigateUp,
    navigateDown,
    handleAutocomplete,
    getCommandFromSuggestion,
    isArgumentCompletion:
      refs.slashCompletionContextRef.current.isArgumentCompletion,
    leafCommand: refs.slashCompletionContextRef.current.leafCommand,
  };
}
