/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  isNodeError,
  getErrorMessage,
  DEFAULT_FILE_FILTERING_OPTIONS,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { toCodePoints } from '../utils/textUtils.js';
import { handleSchemaCompletion } from './schemaCompletionUtils.js';
import {
  parseSlashCommandPath,
  parseCommandArguments,
  calculateCompletionRange,
  checkPerfectMatch,
  filterCommands,
  sortSuggestionsByExactMatch,
} from './slashCommandPathUtils.js';
import {
  parseAtPath,
  findFilesRecursively,
  findFilesWithGlob,
  filterEntriesByPrefix,
  mapEntriesToSuggestions,
  normalizePathSeparators,
  sortSuggestions,
} from './atCompletionUtils.js';
import type { SlashCommandCompletionContext } from './slashCompletionTypes.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

const debugLogger = new DebugLogger('llxprt:ui:slash-completion');

// Issue #2620: schema-based slash-command completion (e.g. /key load <name>)
// previously fired an async completer on every keystroke. A short debounce
// coalesces rapid keystrokes into a single completer invocation. The pending
// timer lives in per-instance state (StateRefs.schemaCompletionTimer) so two
// concurrent hook instances can't interfere with each other's timers; the
// effect cleanup clears it so stale completions cannot land after the user
// moves on.
export const SCHEMA_COMPLETION_DEBOUNCE_MS = 100;

type RuntimeExtensionConfig = Partial<Pick<CliUiRuntime, 'isExtensionEnabled'>>;

type CompletionSetters = {
  setSuggestions: (s: Suggestion[]) => void;
  setShowSuggestions: (show: boolean) => void;
  setActiveSuggestionIndex: (idx: number) => void;
  setActiveHint: (hint: string) => void;
  setIsPerfectMatch: (isPerfect: boolean) => void;
  setIsLoadingSuggestions: (loading: boolean) => void;
  setSlashCompletionContext: (ctx: SlashCommandCompletionContext) => void;
};

type AtSetters = {
  setSuggestions: (s: Suggestion[]) => void;
  setShowSuggestions: (show: boolean) => void;
  setActiveSuggestionIndex: (idx: number) => void;
  setVisibleStartIndex: (idx: number) => void;
  setIsLoadingSuggestions: (loading: boolean) => void;
};

export type AllSetters = CompletionSetters & AtSetters;

export type StateRefs = {
  completionSequenceRef: React.MutableRefObject<number>;
  previousInput: React.MutableRefObject<string>;
  completionStart: React.MutableRefObject<number>;
  completionEnd: React.MutableRefObject<number>;
  schemaCompletionTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  slashCompletionContextRef: React.MutableRefObject<{
    isArgumentCompletion: boolean;
    leafCommand: SlashCommand | null;
    commandMap: Map<string, SlashCommand>;
  }>;
};

function handleSchemaAsync(
  leafCommand: SlashCommand,
  commandContext: CommandContext,
  argString: string,
  completedArgs: string[],
  argPartial: string,
  pathLen: number,
  line: string,
  seq: number,
  seqRef: React.MutableRefObject<number>,
  setters: CompletionSetters,
): void {
  setters.setIsLoadingSuggestions(true);
  handleSchemaCompletion(
    leafCommand,
    commandContext,
    argString,
    completedArgs,
    argPartial,
    pathLen,
    line,
  )
    .then(({ suggestions: fs, hint }) => {
      if (seq !== seqRef.current) {
        return;
      }
      setters.setSuggestions(fs);
      setters.setShowSuggestions(fs.length > 0);
      setters.setActiveSuggestionIndex(fs.length > 0 ? 0 : -1);
      setters.setActiveHint(hint);
      setters.setIsLoadingSuggestions(false);
    })
    .catch((error) => {
      if (seq !== seqRef.current) {
        return;
      }
      debugLogger.error('Schema completion error:', error);
      setters.setSuggestions([]);
      setters.setShowSuggestions(false);
      setters.setActiveSuggestionIndex(-1);
      setters.setActiveHint('');
      setters.setIsLoadingSuggestions(false);
    });
}

function updateCmdSuggestions(
  potential: SlashCommand[],
  partial: string,
  setters: Pick<
    CompletionSetters,
    'setSuggestions' | 'setShowSuggestions' | 'setActiveSuggestionIndex'
  >,
): Map<string, SlashCommand> {
  const sorted = sortSuggestionsByExactMatch(potential, partial);
  const commandMap = new Map<string, SlashCommand>();
  const final = sorted.map((c) => {
    commandMap.set(c.name, c);
    return {
      label: c.name,
      value: c.name,
      description: c.description,
    };
  });
  setters.setSuggestions(final);
  setters.setShowSuggestions(final.length > 0);
  setters.setActiveSuggestionIndex(final.length > 0 ? 0 : -1);
  return commandMap;
}

function handleSchemaArg(
  leaf: SlashCommand,
  ctx: CommandContext,
  trail: boolean,
  argPartial: string,
  completed: string[],
  pathLen: number,
  line: string,
  seq: number,
  seqRef: React.MutableRefObject<number>,
  setters: CompletionSetters,
): void {
  const a = [...completed];
  if (!trail && argPartial) {
    a.push(argPartial);
  }
  handleSchemaAsync(
    leaf,
    ctx,
    a.join(' '),
    completed,
    argPartial,
    pathLen,
    line,
    seq,
    seqRef,
    setters,
  );
}

function handleCmdCompletion(
  level: readonly SlashCommand[] | undefined,
  partial: string,
  extCfg: RuntimeExtensionConfig | null | undefined,
  setters: Pick<
    CompletionSetters,
    | 'setSuggestions'
    | 'setShowSuggestions'
    | 'setActiveSuggestionIndex'
    | 'setActiveHint'
  >,
): Map<string, SlashCommand> {
  const search = level ?? [];
  if (search.length > 0) {
    return updateCmdSuggestions(
      filterCommands(search, {
        commandPartial: partial,
        extensionConfig: extCfg ?? null,
      }),
      partial,
      setters,
    );
  }
  setters.setSuggestions([]);
  setters.setShowSuggestions(false);
  setters.setActiveSuggestionIndex(-1);
  setters.setActiveHint('');
  return new Map<string, SlashCommand>();
}

function processParsed(
  parsed: ReturnType<typeof parseSlashCommandPath>,
  args: ReturnType<typeof parseCommandArguments>,
): {
  leaf: SlashCommand | null;
  level: readonly SlashCommand[] | undefined;
  partial: string;
} {
  let { leafCommand: leaf, currentLevel: level } = parsed;
  let { commandPartial: partial } = args;
  if (args.exactMatchAsParent) {
    leaf = args.exactMatchAsParent;
    level = args.exactMatchAsParent.subCommands as
      | readonly SlashCommand[]
      | undefined;
    partial = '';
  }
  return { leaf, level, partial };
}

function updateCtx(
  parsed: ReturnType<typeof parseSlashCommandPath>,
  args: ReturnType<typeof parseCommandArguments>,
  trail: boolean,
  cmdIdx: number,
  line: string,
  setters: CompletionSetters,
): {
  leaf: SlashCommand | null;
  level: readonly SlashCommand[] | undefined;
  partial: string;
  isArg: boolean;
  completionStart: number;
  completionEnd: number;
} {
  const { leaf, level, partial } = processParsed(parsed, args);
  const { isPerfectMatch } = checkPerfectMatch(
    leaf,
    partial,
    args.argumentPartial,
    args.leafSupportsArguments,
    level,
    trail,
  );
  if (isPerfectMatch) {
    setters.setIsPerfectMatch(true);
    setters.setActiveHint('');
  }
  const isArg =
    args.leafSupportsArguments && (parsed.remainingParts.length > 0 || trail);
  const active = args.leafSupportsArguments ? args.argumentPartial : partial;
  const r = calculateCompletionRange(
    cmdIdx,
    line,
    trail,
    args.exactMatchAsParent,
    active,
  );
  setters.setSlashCompletionContext({
    isArgumentCompletion: isArg,
    leafCommand: leaf,
    completionStart: r.start,
    completionEnd: r.end,
    commandMap: new Map<string, SlashCommand>(),
  });
  return {
    leaf,
    level,
    partial,
    isArg,
    completionStart: r.start,
    completionEnd: r.end,
  };
}

function processSlash(
  line: string,
  cmdIdx: number,
  cmds: readonly SlashCommand[],
  extCfg: RuntimeExtensionConfig | null | undefined,
  seq: number,
  seqRef: React.MutableRefObject<number>,
  ctx: CommandContext,
  setters: CompletionSetters,
  refs: StateRefs,
): void {
  setters.setIsPerfectMatch(false);
  const trail = line.endsWith(' ');
  const parsed = parseSlashCommandPath(line.substring(cmdIdx + 1), trail, cmds);
  const args = parseCommandArguments(
    parsed.remainingParts,
    trail,
    parsed.leafCommand,
    parsed.currentLevel,
  );
  const { leaf, level, partial, isArg, completionStart, completionEnd } =
    updateCtx(parsed, args, trail, cmdIdx, line, setters);
  if (isArg && leaf?.schema) {
    // Debounce the async schema completer so rapid keystrokes coalesce into a
    // single invocation. Each call replaces the pending timer held in
    // per-instance state; the trailing edge fires after
    // SCHEMA_COMPLETION_DEBOUNCE_MS of inactivity. The seq captured here is
    // checked inside handleSchemaAsync, so superseded results (from earlier
    // keystrokes whose timers were cleared before firing) are discarded. The
    // effect cleanup also clears the timer.
    const schemaArgs: Parameters<typeof handleSchemaArg> = [
      leaf,
      ctx,
      trail,
      args.argumentPartial,
      args.completedArgsForSchema,
      parsed.commandPathLength,
      line,
      seq,
      seqRef,
      setters,
    ];
    if (refs.schemaCompletionTimer.current !== null) {
      clearTimeout(refs.schemaCompletionTimer.current);
      refs.schemaCompletionTimer.current = null;
    }
    refs.schemaCompletionTimer.current = setTimeout(() => {
      refs.schemaCompletionTimer.current = null;
      handleSchemaArg(...schemaArgs);
    }, SCHEMA_COMPLETION_DEBOUNCE_MS);
    return;
  }
  const commandMap = handleCmdCompletion(level, partial, extCfg, setters);
  setters.setSlashCompletionContext({
    isArgumentCompletion: isArg,
    leafCommand: leaf,
    completionStart,
    completionEnd,
    commandMap,
  });
}

async function fetchForDir(
  dir: string,
  cwd: string,
  at: ReturnType<typeof parseAtPath>,
  cfg: CliUiRuntime | undefined,
): Promise<Suggestion[]> {
  const fds = cfg ? cfg.getFileService() : null;
  const rec = cfg?.getEnableRecursiveFileSearch() ?? true;
  const fOpts =
    cfg?.getFileFilteringOptions() ?? DEFAULT_FILE_FILTERING_OPTIONS;
  if (at.partialPath.indexOf('/') === -1 && at.prefix && rec) {
    if (fds) {
      return findFilesWithGlob(at.prefix, fds, fOpts, dir, cwd);
    }
    return findFilesRecursively(dir, at.prefix, null, fOpts);
  }
  const base = path.resolve(dir, at.baseDirRelative);
  const entries = await fs.readdir(base, { withFileTypes: true });
  const filtered = filterEntriesByPrefix(entries, at.prefix).filter(
    (e) =>
      fds?.shouldIgnoreFile(
        path.relative(dir, path.join(base, e.name)),
        fOpts,
      ) !== true,
  );
  return mapEntriesToSuggestions(filtered, base, dir, cwd);
}

function handleAtErr(
  error: unknown,
  pp: string,
  mounted: boolean,
  setters: Pick<
    AtSetters,
    'setSuggestions' | 'setShowSuggestions' | 'setActiveSuggestionIndex'
  >,
): void {
  if (isNodeError(error) && error.code === 'ENOENT') {
    if (mounted) {
      setters.setSuggestions([]);
      setters.setShowSuggestions(false);
    }
  } else {
    debugLogger.error(
      `Error fetching completion suggestions for ${pp}: ${getErrorMessage(error)}`,
    );
    if (mounted) {
      setters.setSuggestions([]);
      setters.setShowSuggestions(false);
      setters.setActiveSuggestionIndex(-1);
    }
  }
}

async function fetchAt(
  dirs: readonly string[],
  cwd: string,
  at: ReturnType<typeof parseAtPath>,
  cfg: CliUiRuntime | undefined,
  mounted: { current: boolean },
  setters: AtSetters,
): Promise<void> {
  const timer = setTimeout(() => {
    setters.setIsLoadingSuggestions(true);
  }, 200);
  try {
    let fetched: Suggestion[] = [];
    for (const dir of dirs) {
      fetched = [...fetched, ...(await fetchForDir(dir, cwd, at, cfg))];
    }
    fetched = sortSuggestions(normalizePathSeparators(fetched));
    if (mounted.current) {
      setters.setSuggestions(fetched);
      setters.setShowSuggestions(fetched.length > 0);
      setters.setActiveSuggestionIndex(fetched.length > 0 ? 0 : -1);
      setters.setVisibleStartIndex(0);
    }
  } catch (error: unknown) {
    handleAtErr(error, at.partialPath, mounted.current, setters);
  }
  clearTimeout(timer);
  if (mounted.current) {
    setters.setIsLoadingSuggestions(false);
  }
}

function calcAtEnd(cps: string[], col: number): number {
  let end = cps.length;
  for (let i = col; i < cps.length; i++) {
    if (cps[i] === ' ') {
      let bc = 0;
      for (let j = i - 1; j >= 0 && cps[j] === '\\'; j--) {
        bc++;
      }
      if (bc % 2 === 0) {
        end = i;
        break;
      }
    }
  }
  return end;
}

function handleAtEff(
  line: string,
  cmdIdx: number,
  col: number,
  dirs: readonly string[],
  cwd: string,
  cfg: CliUiRuntime | undefined,
  startRef: React.MutableRefObject<number>,
  endRef: React.MutableRefObject<number>,
  setters: AtSetters,
): (() => void) | undefined {
  const cps = toCodePoints(line);
  endRef.current = calcAtEnd(cps, col);
  const at = parseAtPath(cmdIdx, line, endRef.current);
  const ls = at.partialPath.lastIndexOf('/');
  startRef.current = ls === -1 ? at.pathStart : at.pathStart + ls + 1;
  const mounted = { current: true };
  let timer: NodeJS.Timeout | undefined;
  if (cps[cmdIdx] === '@') {
    timer = setTimeout(() => {
      void fetchAt(dirs, cwd, at, cfg, mounted, setters);
    }, 100);
  }
  return () => {
    mounted.current = false;
    if (timer) clearTimeout(timer);
  };
}

function prepare(
  mi: { line: string; commandIndex: number; cursorCol: number } | null,
  cmdIdx: number,
  col: number,
  cmds: readonly SlashCommand[],
  prev: React.MutableRefObject<string>,
  seqRef: React.MutableRefObject<number>,
): { line: string; seq: number; cps: string[] } | null {
  if (!mi) return null;
  const key = `${mi.line}:${cmdIdx}:${col}:${cmds.length}`;
  if (prev.current === key) {
    debugLogger.debug(() => 'Input unchanged');
    return null;
  }
  prev.current = key;
  const next = seqRef.current + 1;
  seqRef.current = next;
  return { line: mi.line, seq: next, cps: toCodePoints(mi.line) };
}

export function handleCompletionEffect(
  mi: { line: string; commandIndex: number; cursorCol: number } | null,
  cmdIdx: number,
  col: number,
  cmds: readonly SlashCommand[],
  extCfg: RuntimeExtensionConfig | null | undefined,
  ctx: CommandContext,
  cfg: CliUiRuntime | undefined,
  dirs: readonly string[],
  cwd: string,
  refs: StateRefs,
  reverseSearchActive: boolean,
  resetCompletionState: () => void,
  setActiveHint: (h: string) => void,
  setters: AllSetters,
): (() => void) | undefined {
  if (cmdIdx === -1 || reverseSearchActive) {
    refs.completionSequenceRef.current += 1;
    if (refs.previousInput.current !== '') {
      debugLogger.debug(() => 'Resetting completion state');
      resetCompletionState();
      setActiveHint('');
      refs.previousInput.current = '';
    }
    return undefined;
  }
  const p = prepare(
    mi,
    cmdIdx,
    col,
    cmds,
    refs.previousInput,
    refs.completionSequenceRef,
  );
  if (!p) return undefined;
  if (p.cps[cmdIdx] === '/') {
    processSlash(
      p.line,
      cmdIdx,
      cmds,
      extCfg,
      p.seq,
      refs.completionSequenceRef,
      ctx,
      setters,
      refs,
    );
    // Clear any pending debounced schema-completion timer so a stale result
    // cannot land after the user has moved on to a different input.
    return () => {
      if (refs.schemaCompletionTimer.current !== null) {
        clearTimeout(refs.schemaCompletionTimer.current);
        refs.schemaCompletionTimer.current = null;
      }
    };
  }
  return handleAtEff(
    p.line,
    cmdIdx,
    col,
    dirs,
    cwd,
    cfg,
    refs.completionStart,
    refs.completionEnd,
    setters,
  );
}
