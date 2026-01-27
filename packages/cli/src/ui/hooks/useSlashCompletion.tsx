/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import {
  isNodeError,
  escapePath,
  unescapePath,
  getErrorMessage,
  Config,
  FileDiscoveryService,
  DEFAULT_FILE_FILTERING_OPTIONS,
  SHELL_SPECIAL_CHARS,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { Suggestion } from '../components/SuggestionsDisplay.js';
import { CommandContext, SlashCommand } from '../commands/types.js';
import {
  logicalPosToOffset,
  TextBuffer,
} from '../components/shared/text-buffer.js';
import { isSlashCommand } from '../utils/commandUtils.js';
import { toCodePoints } from '../utils/textUtils.js';
import { useCompletion } from './useCompletion.js';
import { createCompletionHandler } from '../commands/schema/index.js';

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * Feature flag enabled for hint display integration
 */
const SHOW_ARGUMENT_HINTS = true;

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-001
 * @requirement:REQ-002
 * @pseudocode ArgumentSchema.md lines 71-90
 * Integration of schema-driven completion system
 *
 * The schema system provides a more structured approach to command completion:
 * - Import: import { createCompletionHandler } from '../commands/schema/index.js';
 * - Create handler: const handler = createCompletionHandler(commandSchema);
 * - Use handler: const suggestions = await handler(commandContext, partialArg, fullLine);
 *
 * Schema completion is now available for commands that provide a schema definition.
 * The integration maintains existing UI behavior while providing enhanced completion.
 */

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @pseudocode ArgumentSchema.md lines 71-90
 * Full integration of schema-driven completion system with hints
 * - Line 71: call createCompletionHandler with current command context
 * - Line 72: supply schema specific to active command
 * - Line 73: capture { suggestions, hint } result
 * - Line 74: set state for suggestions and new activeHint field
 * - Line 75: handle pending async results with sequence/timestamp guard
 * - Line 76-78: gracefully handle resolver errors (log + fallback to empty suggestions + hint)
 * - Line 79-80: ensure cleanup on component unmount / completion reset
 */

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
  handleAutocomplete: (indexToUse: number) => void;
}

const debugLogger = new DebugLogger('llxprt:ui:slash-completion');

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

  // Track active hint for schema-based completions
  const [activeHint, setActiveHint] = React.useState<string>('');

  // Track async completion sequence to avoid race conditions
  const completionSequenceRef = useRef<number>(0);

  const completionStart = useRef(-1);
  const completionEnd = useRef(-1);

  // Track the previous input to avoid unnecessary re-computations
  const previousInput = useRef<string>('');

  const cursorRow = buffer.cursor[0];
  const cursorCol = buffer.cursor[1];

  // Check if cursor is after @ or / without unescaped spaces
  const commandIndex = useMemo(() => {
    const currentLine = buffer.lines[cursorRow] || '';
    debugLogger.debug(
      () => `Checking commandIndex - Row: ${cursorRow}, Line: "${currentLine}"`,
    );
    if (cursorRow === 0 && isSlashCommand(currentLine.trim())) {
      const index = currentLine.indexOf('/');
      debugLogger.debug(() => `Slash command detected at index ${index}`);
      return index;
    }

    // For other completions like '@', we search backwards from the cursor.

    const codePoints = toCodePoints(currentLine);
    for (let i = cursorCol - 1; i >= 0; i--) {
      const char = codePoints[i];

      if (char === ' ') {
        // Check for unescaped spaces.
        let backslashCount = 0;
        for (let j = i - 1; j >= 0 && codePoints[j] === '\\'; j--) {
          backslashCount++;
        }
        if (backslashCount % 2 === 0) {
          return -1; // Inactive on unescaped space.
        }
      } else if (char === '@') {
        // Active if we find an '@' before any unescaped space.
        return i;
      }
    }

    return -1;
  }, [cursorRow, cursorCol, buffer.lines]);

  // Memoize the current input to avoid re-processing on unrelated re-renders
  const memoizedInput = useMemo(() => {
    if (commandIndex === -1) return null;
    const currentLine = buffer.lines[cursorRow] || '';
    return {
      line: currentLine,
      commandIndex,
      cursorCol,
    };
  }, [buffer.lines, cursorRow, commandIndex, cursorCol]);

  useEffect(() => {
    if (commandIndex === -1 || reverseSearchActive) {
      // Only reset if we actually had suggestions or hints before
      if (previousInput.current !== '') {
        debugLogger.debug(() => 'Resetting completion state');
        resetCompletionState();
        setActiveHint('');
        previousInput.current = '';
      }
      return;
    }

    debugLogger.debug(
      () =>
        `useEffect triggered - commandIndex: ${commandIndex}, reverseSearchActive: ${reverseSearchActive}`,
    );

    if (!memoizedInput) return;

    const currentLine = memoizedInput.line;

    // Check if the input actually changed
    // Include slashCommands.length in key to detect command list changes (e.g., extension enable/disable)
    const currentInputKey = `${currentLine}:${commandIndex}:${cursorCol}:${slashCommands.length}`;
    if (previousInput.current === currentInputKey) {
      debugLogger.debug(() => 'Input unchanged, skipping re-computation');
      return;
    }
    previousInput.current = currentInputKey;

    // Increment completion sequence for race condition protection
    const currentSequence = ++completionSequenceRef.current;

    const codePoints = toCodePoints(currentLine);

    if (codePoints[commandIndex] === '/') {
      // Always reset perfect match at the beginning of processing.
      setIsPerfectMatch(false);

      const fullPath = currentLine.substring(commandIndex + 1);
      const hasTrailingSpace = currentLine.endsWith(' ');

      const rawParts = fullPath.split(/\s+/).filter((p) => p);

      const pathParts: string[] = [];
      let currentLevel: readonly SlashCommand[] | undefined = slashCommands;
      let leafCommand: SlashCommand | null = null;

      for (const part of rawParts) {
        if (!currentLevel) {
          break;
        }
        const found = currentLevel.find(
          (cmd) => cmd.name === part || cmd.altNames?.includes(part),
        );
        if (!found) {
          break;
        }
        pathParts.push(part);
        leafCommand = found;
        currentLevel = found.subCommands as readonly SlashCommand[] | undefined;
      }

      const remainingParts = rawParts.slice(pathParts.length);
      const commandPathLength = pathParts.length;

      const leafSupportsArguments = Boolean(leafCommand?.schema);

      let commandPartial = '';
      let argumentPartial = '';
      let completedArgsForSchema: string[] = [];

      if (leafSupportsArguments) {
        if (remainingParts.length > 0) {
          if (hasTrailingSpace) {
            completedArgsForSchema = remainingParts;
          } else {
            argumentPartial = remainingParts[remainingParts.length - 1];
            completedArgsForSchema = remainingParts.slice(0, -1);
          }
        }
      } else if (!hasTrailingSpace && remainingParts.length > 0) {
        commandPartial = remainingParts[remainingParts.length - 1];
      }

      let exactMatchAsParent: SlashCommand | undefined;
      if (!hasTrailingSpace && currentLevel) {
        const candidate = commandPartial || argumentPartial;
        if (candidate) {
          exactMatchAsParent = currentLevel.find(
            (cmd) =>
              (cmd.name === candidate || cmd.altNames?.includes(candidate)) &&
              cmd.subCommands,
          );

          if (exactMatchAsParent) {
            leafCommand = exactMatchAsParent;
            currentLevel = exactMatchAsParent.subCommands;
            commandPartial = '';
            argumentPartial = '';
          }
        }
      }

      // Check for perfect, executable match
      if (!hasTrailingSpace) {
        if (
          leafCommand &&
          commandPartial === '' &&
          argumentPartial === '' &&
          leafCommand.action &&
          !leafSupportsArguments
        ) {
          setIsPerfectMatch(true);
          setActiveHint('');
        } else if (currentLevel && commandPartial) {
          const perfectMatch = currentLevel.find(
            (cmd) =>
              (cmd.name === commandPartial ||
                cmd.altNames?.includes(commandPartial)) &&
              cmd.action,
          );
          if (perfectMatch) {
            setIsPerfectMatch(true);
            setActiveHint('');
          }
        }
      }

      const hasArgumentTokens = remainingParts.length > 0 || hasTrailingSpace;
      const isArgumentCompletion = leafSupportsArguments && hasArgumentTokens;

      // Set completion range
      const activePartial = leafSupportsArguments
        ? argumentPartial
        : commandPartial;

      if (hasTrailingSpace || exactMatchAsParent) {
        completionStart.current = currentLine.length;
        completionEnd.current = currentLine.length;
      } else if (activePartial) {
        completionStart.current = currentLine.length - activePartial.length;
        completionEnd.current = currentLine.length;
      } else {
        // e.g. /
        completionStart.current = commandIndex + 1;
        completionEnd.current = currentLine.length;
      }

      // Provide Suggestions based on the now-corrected context
      if (isArgumentCompletion) {
        const argsForHandler = [...completedArgsForSchema];
        if (!hasTrailingSpace && argumentPartial) {
          argsForHandler.push(argumentPartial);
        }
        const argString = argsForHandler.join(' ');

        // Check if command has schema-based completion
        if (leafCommand!.schema) {
          /**
           * @plan:PLAN-20251013-AUTOCOMPLETE.P08
           * @requirement:REQ-002
           * @requirement:REQ-003
           * @requirement:REQ-004
           * @pseudocode ArgumentSchema.md lines 71-90
           * Full integration of schema handler with hint support
           * - Line 71: call createCompletionHandler with current command schema
           * - Line 72: supply schema specific to active command
           * - Line 73: capture { suggestions, hint } result
           * - Line 74: set state for suggestions and activeHint field
           * - Line 75: handle pending async results with sequence guard
           * - Line 76-78: gracefully handle resolver errors (log + fallback)
           */
          const schemaHandler = createCompletionHandler(leafCommand!.schema);
          setIsLoadingSuggestions(true);

          schemaHandler(
            commandContext,
            {
              args: argString,
              completedArgs: completedArgsForSchema,
              partialArg: argumentPartial,
              commandPathLength,
            },
            currentLine,
          )
            .then((completionResult) => {
              // Race condition protection: only process if this is the latest completion
              if (currentSequence !== completionSequenceRef.current) {
                return;
              }

              const finalSuggestions = completionResult.suggestions.map(
                (s) => ({
                  label: s.value,
                  value: s.value,
                  description: s.description,
                }),
              );

              // Set suggestions and hint based on feature flag
              setSuggestions(finalSuggestions);
              setShowSuggestions(finalSuggestions.length > 0);
              setActiveSuggestionIndex(finalSuggestions.length > 0 ? 0 : -1);

              if (SHOW_ARGUMENT_HINTS) {
                setActiveHint(completionResult.hint || '');
              } else {
                setActiveHint('');
              }

              setIsLoadingSuggestions(false);
            })
            .catch((error) => {
              // Race condition protection: only process if this is the latest completion
              if (currentSequence !== completionSequenceRef.current) {
                return;
              }

              console.error('Schema completion error:', error);
              setSuggestions([]);
              setShowSuggestions(false);
              setActiveSuggestionIndex(-1);
              setActiveHint('');
              setIsLoadingSuggestions(false);
            });
          return;
        }
      }

      // Command/Sub-command Completion
      const commandsToSearch = currentLevel || [];
      debugLogger.debug(
        () =>
          `Commands to search: ${commandsToSearch.length}, Partial: "${commandPartial}"`,
      );
      debugLogger.debug(
        () => `currentLevel: ${currentLevel ? 'exists' : 'null/undefined'}`,
      );
      debugLogger.debug(() => `slashCommands at root: ${slashCommands.length}`);
      if (commandsToSearch.length > 0) {
        let potentialSuggestions = commandsToSearch.filter((cmd) => {
          // Filter extension commands: must have extensionName AND be enabled
          if (cmd.kind === 'extension') {
            // Extension commands without extensionName are treated as invalid/disabled
            if (!cmd.extensionName) {
              return false;
            }
            const config = commandContext.services?.config;
            if (config && typeof config.isExtensionEnabled === 'function') {
              if (!config.isExtensionEnabled(cmd.extensionName)) {
                return false;
              }
            }
          }
          // Match by name or altNames
          return (
            cmd.description &&
            (cmd.name.startsWith(commandPartial) ||
              cmd.altNames?.some((alt) => alt.startsWith(commandPartial)))
          );
        });
        debugLogger.debug(
          () => `Found ${potentialSuggestions.length} potential suggestions`,
        );

        // If a user's input is an exact match and it is a leaf command,
        // enter should submit immediately.
        if (potentialSuggestions.length > 0 && !hasTrailingSpace) {
          const perfectMatch = potentialSuggestions.find(
            (s) =>
              s.name === commandPartial || s.altNames?.includes(commandPartial),
          );
          if (perfectMatch && perfectMatch.action) {
            potentialSuggestions = [];
          }
        }

        const finalSuggestions = potentialSuggestions.map((cmd) => ({
          label: cmd.name,
          value: cmd.name,
          description: cmd.description,
        }));

        setSuggestions(finalSuggestions);
        setShowSuggestions(finalSuggestions.length > 0);
        setActiveSuggestionIndex(finalSuggestions.length > 0 ? 0 : -1);
        // Don't set loading state - we never showed loading for command completions
        return;
      }

      // If we fall through, no suggestions are available.
      // Don't reset everything - just set empty suggestions and clear hint
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      setActiveHint('');
      return;
    }

    // Handle At Command Completion - this needs async file operations
    completionEnd.current = codePoints.length;
    for (let i = cursorCol; i < codePoints.length; i++) {
      if (codePoints[i] === ' ') {
        let backslashCount = 0;
        for (let j = i - 1; j >= 0 && codePoints[j] === '\\'; j--) {
          backslashCount++;
        }

        if (backslashCount % 2 === 0) {
          completionEnd.current = i;
          break;
        }
      }
    }

    const pathStart = commandIndex + 1;
    const partialPath = currentLine.substring(pathStart, completionEnd.current);
    const lastSlashIndex = partialPath.lastIndexOf('/');
    completionStart.current =
      lastSlashIndex === -1 ? pathStart : pathStart + lastSlashIndex + 1;
    const baseDirRelative =
      lastSlashIndex === -1
        ? '.'
        : partialPath.substring(0, lastSlashIndex + 1);
    const prefix = unescapePath(
      lastSlashIndex === -1
        ? partialPath
        : partialPath.substring(lastSlashIndex + 1),
    );

    let isMounted = true;

    const findFilesRecursively = async (
      startDir: string,
      searchPrefix: string,
      fileDiscovery: FileDiscoveryService | null,
      filterOptions: {
        respectGitIgnore?: boolean;
        respectLlxprtIgnore?: boolean;
      },
      currentRelativePath = '',
      depth = 0,
      maxDepth = 10, // Limit recursion depth
      maxResults = 50, // Limit number of results
    ): Promise<Suggestion[]> => {
      if (depth > maxDepth) {
        return [];
      }

      const lowerSearchPrefix = searchPrefix.toLowerCase();
      let foundSuggestions: Suggestion[] = [];
      try {
        const entries = await fs.readdir(startDir, { withFileTypes: true });
        for (const entry of entries) {
          if (foundSuggestions.length >= maxResults) break;

          const entryPathRelative = path.join(currentRelativePath, entry.name);
          const entryPathFromRoot = path.relative(
            startDir,
            path.join(startDir, entry.name),
          );

          // Conditionally ignore dotfiles
          if (!searchPrefix.startsWith('.') && entry.name.startsWith('.')) {
            continue;
          }

          // Check if this entry should be ignored by filtering options
          if (
            fileDiscovery &&
            fileDiscovery.shouldIgnoreFile(entryPathFromRoot, filterOptions)
          ) {
            continue;
          }

          if (entry.name.toLowerCase().startsWith(lowerSearchPrefix)) {
            foundSuggestions.push({
              label: entryPathRelative + (entry.isDirectory() ? '/' : ''),
              value: escapePath(
                entryPathRelative + (entry.isDirectory() ? '/' : ''),
              ),
            });
          }
          if (
            entry.isDirectory() &&
            entry.name !== 'node_modules' &&
            !entry.name.startsWith('.')
          ) {
            if (foundSuggestions.length < maxResults) {
              foundSuggestions = foundSuggestions.concat(
                await findFilesRecursively(
                  path.join(startDir, entry.name),
                  searchPrefix, // Pass original searchPrefix for recursive calls
                  fileDiscovery,
                  filterOptions,
                  entryPathRelative,
                  depth + 1,
                  maxDepth,
                  maxResults - foundSuggestions.length,
                ),
              );
            }
          }
        }
      } catch (_err) {
        // Ignore errors like permission denied or ENOENT during recursive search
      }
      return foundSuggestions.slice(0, maxResults);
    };

    const findFilesWithGlob = async (
      searchPrefix: string,
      fileDiscoveryService: FileDiscoveryService,
      filterOptions: {
        respectGitIgnore?: boolean;
        respectLlxprtIgnore?: boolean;
      },
      searchDir: string,
      maxResults = 50,
    ): Promise<Suggestion[]> => {
      const globPattern = `**/${searchPrefix}*`;
      const files = await glob(globPattern, {
        cwd: searchDir,
        dot: searchPrefix.startsWith('.'),
        nocase: true,
      });

      const suggestions: Suggestion[] = files
        .filter((file) => {
          if (fileDiscoveryService) {
            return !fileDiscoveryService.shouldIgnoreFile(file, filterOptions);
          }
          return true;
        })
        .map((file: string) => {
          const absolutePath = path.resolve(searchDir, file);
          const label = path.relative(cwd, absolutePath);
          return {
            label,
            value: escapePath(label),
          };
        })
        .slice(0, maxResults);

      return suggestions;
    };

    const fetchSuggestions = async () => {
      let fetchedSuggestions: Suggestion[] = [];

      // We'll only set loading state if the operation actually takes time
      let loadingTimer: NodeJS.Timeout | null = null;

      // Set loading state after a delay to avoid flicker for fast operations
      loadingTimer = setTimeout(() => {
        setIsLoadingSuggestions(true);
      }, 200); // Only show loading if operation takes more than 200ms

      const fileDiscoveryService = config ? config.getFileService() : null;
      const enableRecursiveSearch =
        config?.getEnableRecursiveFileSearch() ?? true;
      const filterOptions =
        config?.getFileFilteringOptions() ?? DEFAULT_FILE_FILTERING_OPTIONS;

      try {
        // If there's no slash, or it's the root, do a recursive search from workspace directories
        for (const dir of dirs) {
          let fetchedSuggestionsPerDir: Suggestion[] = [];
          if (
            partialPath.indexOf('/') === -1 &&
            prefix &&
            enableRecursiveSearch
          ) {
            if (fileDiscoveryService) {
              fetchedSuggestionsPerDir = await findFilesWithGlob(
                prefix,
                fileDiscoveryService,
                filterOptions,
                dir,
              );
            } else {
              fetchedSuggestionsPerDir = await findFilesRecursively(
                dir,
                prefix,
                null,
                filterOptions,
              );
            }
          } else {
            // Original behavior: list files in the specific directory
            const lowerPrefix = prefix.toLowerCase();
            const baseDirAbsolute = path.resolve(dir, baseDirRelative);
            const entries = await fs.readdir(baseDirAbsolute, {
              withFileTypes: true,
            });

            // Filter entries using git-aware filtering
            const filteredEntries = [];
            for (const entry of entries) {
              // Conditionally ignore dotfiles
              if (!prefix.startsWith('.') && entry.name.startsWith('.')) {
                continue;
              }
              if (!entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

              const relativePath = path.relative(
                dir,
                path.join(baseDirAbsolute, entry.name),
              );
              if (
                fileDiscoveryService &&
                fileDiscoveryService.shouldIgnoreFile(
                  relativePath,
                  filterOptions,
                )
              ) {
                continue;
              }

              filteredEntries.push(entry);
            }

            fetchedSuggestionsPerDir = filteredEntries.map((entry) => {
              const absolutePath = path.resolve(baseDirAbsolute, entry.name);
              const label =
                cwd === dir ? entry.name : path.relative(cwd, absolutePath);
              const suggestionLabel = entry.isDirectory() ? label + '/' : label;
              return {
                label: suggestionLabel,
                value: escapePath(suggestionLabel),
              };
            });
          }
          fetchedSuggestions = [
            ...fetchedSuggestions,
            ...fetchedSuggestionsPerDir,
          ];
        }

        // Like glob, we always return forward slashes for path separators, even on Windows.
        // But preserve backslash escaping for special characters.
        const specialCharsLookahead = `(?![${SHELL_SPECIAL_CHARS.source.slice(1, -1)}])`;
        const pathSeparatorRegex = new RegExp(
          `\\\\${specialCharsLookahead}`,
          'g',
        );
        fetchedSuggestions = fetchedSuggestions.map((suggestion) => ({
          ...suggestion,
          label: suggestion.label.replace(pathSeparatorRegex, '/'),
          value: suggestion.value.replace(pathSeparatorRegex, '/'),
        }));

        // Sort by depth, then directories first, then alphabetically
        fetchedSuggestions.sort((a, b) => {
          const depthA = (a.label.match(/\//g) || []).length;
          const depthB = (b.label.match(/\//g) || []).length;

          if (depthA !== depthB) {
            return depthA - depthB;
          }

          const aIsDir = a.label.endsWith('/');
          const bIsDir = b.label.endsWith('/');
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;

          // exclude extension when comparing
          const filenameA = a.label.substring(
            0,
            a.label.length - path.extname(a.label).length,
          );
          const filenameB = b.label.substring(
            0,
            b.label.length - path.extname(b.label).length,
          );

          return (
            filenameA.localeCompare(filenameB) || a.label.localeCompare(b.label)
          );
        });

        if (isMounted) {
          setSuggestions(fetchedSuggestions);
          setShowSuggestions(fetchedSuggestions.length > 0);
          setActiveSuggestionIndex(fetchedSuggestions.length > 0 ? 0 : -1);
          setVisibleStartIndex(0);
        }
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          if (isMounted) {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          console.error(
            `Error fetching completion suggestions for ${partialPath}: ${getErrorMessage(error)}`,
          );
          if (isMounted) {
            // Don't reset everything on error - just clear suggestions
            setSuggestions([]);
            setShowSuggestions(false);
            setActiveSuggestionIndex(-1);
          }
        }
      }

      // Clear the loading timer if it hasn't fired yet
      if (loadingTimer) {
        clearTimeout(loadingTimer);
      }

      if (isMounted) {
        setIsLoadingSuggestions(false);
      }
    };

    // Only schedule async file operations for @ commands
    // Slash commands are handled synchronously above and return early
    let debounceTimeout: NodeJS.Timeout | undefined;
    if (codePoints[commandIndex] === '@') {
      // File operations are expensive and benefit from debouncing
      debounceTimeout = setTimeout(fetchSuggestions, 100);
    }

    return () => {
      isMounted = false;
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [
    // Only re-run when the actual input changes
    memoizedInput,
    commandIndex,
    cursorCol,
    reverseSearchActive,
    // These are needed for the computation
    dirs,
    cwd,
    slashCommands,
    commandContext,
    commandContext.services?.config, // Add explicit dependency on config to catch changes
    config,
    // These are the setters - they're stable references
    resetCompletionState,
    setSuggestions,
    setShowSuggestions,
    setActiveSuggestionIndex,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
    setVisibleStartIndex,
  ]);

  const handleAutocomplete = useCallback(
    (indexToUse: number) => {
      if (indexToUse < 0 || indexToUse >= suggestions.length) {
        return;
      }
      const suggestion = suggestions[indexToUse].value;

      if (completionStart.current === -1 || completionEnd.current === -1) {
        return;
      }

      const isSlash = (buffer.lines[cursorRow] || '')[commandIndex] === '/';
      let suggestionText = suggestion;
      if (isSlash) {
        // If we are inserting (not replacing), and the preceding character is not a space, add one.
        if (
          completionStart.current === completionEnd.current &&
          completionStart.current > commandIndex + 1 &&
          (buffer.lines[cursorRow] || '')[completionStart.current - 1] !== ' '
        ) {
          suggestionText = ' ' + suggestionText;
        }
      }

      suggestionText += ' ';

      buffer.replaceRangeByOffset(
        logicalPosToOffset(buffer.lines, cursorRow, completionStart.current),
        logicalPosToOffset(buffer.lines, cursorRow, completionEnd.current),
        suggestionText,
      );

      // Clear current suggestions so we don't re-apply stale entries while
      // the resolver recomputes the next argument context.
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      setVisibleStartIndex(0);
      setActiveHint('');
      setIsLoadingSuggestions(false);
    },
    [
      cursorRow,
      buffer,
      suggestions,
      commandIndex,
      setSuggestions,
      setShowSuggestions,
      setActiveSuggestionIndex,
      setVisibleStartIndex,
      setActiveHint,
      setIsLoadingSuggestions,
    ],
  );

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
  };
}
