/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { type HydratedModel } from '@vybestack/llxprt-code-core';

export interface CapabilityFilters {
  vision: boolean;
  reasoning: boolean;
}

export interface ModelsDialogProps {
  onSelect: (model: HydratedModel) => void;
  onClose: () => void;
  initialSearch?: string;
  initialFilters?: Partial<CapabilityFilters>;
  includeDeprecated?: boolean;
  /** User's current provider from runtime */
  currentProvider?: string | null;
  /** Override provider filter from --provider arg */
  initialProviderFilter?: string | null;
  /** Show all providers (from --all flag) */
  showAllProviders?: boolean;
}

interface ModelsDialogState {
  searchTerm: string;
  filters: CapabilityFilters;
  selectedIndex: number;
  scrollOffset: number;
  mode: 'search' | 'filter';
  allModels: HydratedModel[];
  isLoading: boolean;
  /** Current provider filter, null means "all providers" */
  providerFilter: string | null;
}

// Format context window (e.g., 200000 -> "200K", 1000000 -> "1M")
function formatContext(tokens: number | undefined): string {
  if (!tokens) return '-';
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}K`;
  return String(tokens);
}

// Format capabilities as letters (V=vision, R=reasoning)
// Note: All models now have tool support (filtered at provider level), audio not supported
function formatCaps(
  caps: HydratedModel['capabilities'],
  narrow: boolean,
): string {
  const letters: string[] = [];
  if (caps?.vision) letters.push('V');
  if (caps?.reasoning) letters.push('R');
  return narrow ? letters.join('') : letters.join(' ');
}

// Truncate model ID if too long
function truncateModelId(id: string, maxLen: number): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 1) + '\u2026';
}

export const ModelsDialog: React.FC<ModelsDialogProps> = ({
  onSelect,
  onClose,
  initialSearch = '',
  initialFilters = {},
  includeDeprecated = false,
  currentProvider = null,
  initialProviderFilter,
  showAllProviders = false,
}) => {
  const { isNarrow, width } = useResponsive();
  const runtime = useRuntimeApi();

  // Get supported providers from runtime
  const supportedProviders = useMemo(() => {
    try {
      return runtime.listProviders();
    } catch {
      return [];
    }
  }, [runtime]);

  // Determine initial provider filter:
  // 1. --all flag → null (show all)
  // 2. --provider X → X
  // 3. Neither → currentProvider (if set)
  // 4. No current provider → null (show all)
  const computedInitialFilter = useMemo(() => {
    if (showAllProviders) return null;
    if (initialProviderFilter !== undefined) return initialProviderFilter;
    return currentProvider ?? null;
  }, [showAllProviders, initialProviderFilter, currentProvider]);

  const [state, setState] = useState<ModelsDialogState>({
    searchTerm: initialSearch,
    filters: {
      vision: initialFilters.vision ?? false,
      reasoning: initialFilters.reasoning ?? false,
    },
    selectedIndex: 0,
    scrollOffset: 0,
    mode: 'search',
    allModels: [],
    isLoading: true,
    providerFilter: computedInitialFilter,
  });

  // Track which providers we've already fetched to avoid re-fetching
  const fetchedProvidersRef = useRef<Set<string>>(new Set());

  // Load models - only fetch from providers we need to display
  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      // Determine which providers to fetch from:
      // - If providerFilter is set → only that provider (fast path)
      // - If showing all (null) → fetch from all providers
      const providersToFetch = state.providerFilter
        ? [state.providerFilter]
        : supportedProviders;

      // Filter out providers we've already fetched
      const newProviders = providersToFetch.filter(
        (p) => !fetchedProvidersRef.current.has(p),
      );

      // If we have nothing new to fetch, just clear loading state
      if (newProviders.length === 0) {
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        // Fetch in parallel for better performance
        const results = await Promise.allSettled(
          newProviders.map((providerName) =>
            runtime.listAvailableModels(providerName),
          ),
        );

        const newModels: HydratedModel[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') {
            newModels.push(...result.value);
          }
        }

        if (!cancelled) {
          // Track which providers we've now fetched
          newProviders.forEach((p) => fetchedProvidersRef.current.add(p));

          // Merge new models with existing, deduplicating
          setState((prev) => {
            const seen = new Set<string>();
            const mergedModels = [...prev.allModels, ...newModels].filter(
              (m) => {
                const key = `${m.provider}:${m.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              },
            );

            return {
              ...prev,
              allModels: mergedModels,
              isLoading: false,
            };
          });
        }
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    };

    setState((prev) => ({ ...prev, isLoading: true }));
    loadModels();

    return () => {
      cancelled = true;
    };
  }, [runtime, supportedProviders, state.providerFilter]);

  // Filter models based on search and capability filters
  const filteredModels = useMemo(() => {
    let models = state.allModels;

    // 1. Provider filter - models already have provider name set
    if (state.providerFilter) {
      models = models.filter((m) => m.provider === state.providerFilter);
    }

    // 2. Filter deprecated (only if hydrated with metadata)
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }

    // 3. Filter by search term
    if (state.searchTerm) {
      const term = state.searchTerm.toLowerCase();
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(term) ||
          m.name.toLowerCase().includes(term) ||
          (m.modelId?.toLowerCase().includes(term) ?? false) ||
          m.provider.toLowerCase().includes(term),
      );
    }

    // 4. Filter by capabilities (AND logic) - only if hydrated
    // Note: All models now have tool support (filtered at provider level)
    if (state.filters.vision) {
      models = models.filter((m) => m.capabilities?.vision);
    }
    if (state.filters.reasoning) {
      models = models.filter((m) => m.capabilities?.reasoning);
    }

    // Sort by provider, then model ID
    models.sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.id.localeCompare(b.id);
    });

    return models;
  }, [
    state.allModels,
    state.providerFilter,
    state.searchTerm,
    state.filters,
    includeDeprecated,
  ]);

  // Reset selection and scroll when filters change
  useEffect(() => {
    setState((prev) => ({ ...prev, selectedIndex: 0, scrollOffset: 0 }));
  }, [state.searchTerm, state.filters, state.providerFilter]);

  // Get active filter names for display
  const activeFilters = useMemo(() => {
    const active: string[] = [];
    if (state.filters.vision) active.push('V');
    if (state.filters.reasoning) active.push('R');
    return active;
  }, [state.filters]);

  // Baseline count: models after provider + deprecated filters, before search/caps
  const baselineCount = useMemo(() => {
    let models = state.allModels;

    // 1. Provider filter
    if (state.providerFilter) {
      models = models.filter((m) => m.provider === state.providerFilter);
    }

    // 2. Filter deprecated
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }

    return models.length;
  }, [state.allModels, state.providerFilter, includeDeprecated]);

  // Check if search or capability filters are active
  const hasActiveFilters =
    state.searchTerm.length > 0 || activeFilters.length > 0;

  // Handle keyboard input
  const handleKeypress = useCallback(
    (key: {
      name?: string;
      sequence?: string;
      ctrl?: boolean;
      meta?: boolean;
    }) => {
      // Escape handling
      if (key.name === 'escape') {
        if (state.searchTerm.length > 0) {
          setState((prev) => ({ ...prev, searchTerm: '' }));
        } else {
          onClose();
        }
        return;
      }

      // Tab to switch modes
      if (key.name === 'tab') {
        setState((prev) => ({
          ...prev,
          mode: prev.mode === 'search' ? 'filter' : 'search',
        }));
        return;
      }

      // Ctrl+A toggles provider filter (all providers vs current provider)
      if (key.name === 'a' && key.ctrl && currentProvider) {
        setState((prev) => ({
          ...prev,
          providerFilter:
            prev.providerFilter === null
              ? currentProvider // Switch to current provider
              : null, // Switch to all providers
          selectedIndex: 0,
          scrollOffset: 0,
        }));
        return;
      }

      // Enter to select
      if (key.name === 'return' && filteredModels.length > 0) {
        const selected = filteredModels[state.selectedIndex];
        if (selected) {
          onSelect(selected);
        }
        return;
      }

      // Navigation with scroll (arrow keys only)
      const maxVisible = 15;
      if (key.name === 'up') {
        setState((prev) => {
          const newIndex = Math.max(0, prev.selectedIndex - 1);
          let newOffset = prev.scrollOffset;
          // Scroll up if selection goes above visible area
          if (newIndex < prev.scrollOffset) {
            newOffset = newIndex;
          }
          return { ...prev, selectedIndex: newIndex, scrollOffset: newOffset };
        });
        return;
      }
      if (key.name === 'down') {
        setState((prev) => {
          const newIndex = Math.min(
            filteredModels.length - 1,
            prev.selectedIndex + 1,
          );
          let newOffset = prev.scrollOffset;
          // Scroll down if selection goes below visible area
          if (newIndex >= prev.scrollOffset + maxVisible) {
            newOffset = newIndex - maxVisible + 1;
          }
          return { ...prev, selectedIndex: newIndex, scrollOffset: newOffset };
        });
        return;
      }

      // Filter mode: toggle filters with letter keys (V=vision, R=reasoning)
      if (state.mode === 'filter') {
        if (key.name === 'v' || key.sequence === 'v') {
          setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, vision: !prev.filters.vision },
          }));
          return;
        }
        if (key.name === 'r' || key.sequence === 'r') {
          setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, reasoning: !prev.filters.reasoning },
          }));
          return;
        }
      }

      // Search mode: typing
      if (state.mode === 'search') {
        if (key.name === 'backspace' || key.name === 'delete') {
          setState((prev) => ({
            ...prev,
            searchTerm: prev.searchTerm.slice(0, -1),
          }));
          return;
        }
        // Add printable characters to search
        if (
          key.sequence &&
          key.sequence.length === 1 &&
          !key.ctrl &&
          !key.meta &&
          key.sequence.match(/[\x20-\x7E]/)
        ) {
          setState((prev) => ({
            ...prev,
            searchTerm: prev.searchTerm + key.sequence,
          }));
        }
      }
    },
    [
      state.mode,
      state.searchTerm,
      state.selectedIndex,
      filteredModels,
      onClose,
      onSelect,
      currentProvider,
    ],
  );

  useKeypress(handleKeypress, { isActive: true });

  // Column widths - model ID is dynamic based on longest name
  const providerWidth = isNarrow ? 0 : 14; // Hide in narrow mode
  const ctxWidth = 10; // Enough for "1.048576M"
  const capsWidth = isNarrow ? 5 : 10;
  const fixedWidth = 2 + 2 + providerWidth + ctxWidth + 2 + capsWidth + 4; // indicator + gap + padding

  // Calculate max model ID length from filtered models
  const maxModelIdLen = useMemo(() => {
    if (filteredModels.length === 0) return 20;
    return Math.max(...filteredModels.map((m) => (m.modelId || m.id).length));
  }, [filteredModels]);

  // Model ID column: use actual max length, but cap at available space
  const availableForModelId = Math.max(20, width - fixedWidth - 6); // -6 for border/padding
  const modelIdWidth = Math.min(maxModelIdLen, availableForModelId);

  // Total row width for separator line
  const tableRowWidth =
    2 +
    modelIdWidth +
    2 +
    (isNarrow ? 0 : providerWidth) +
    ctxWidth +
    2 +
    capsWidth;

  // Max visible rows and scrolling
  const maxRows = 15;
  const visibleModels = filteredModels.slice(
    state.scrollOffset,
    state.scrollOffset + maxRows,
  );

  // Render filter button
  const renderFilterButton = (label: string, active: boolean) => (
    <Text
      color={
        active ? SemanticColors.text.accent : SemanticColors.text.secondary
      }
    >
      [{label}]
    </Text>
  );

  // Render model row (visibleIndex is 0-based within visible slice)
  const renderRow = (model: HydratedModel, visibleIndex: number) => {
    const absoluteIndex = state.scrollOffset + visibleIndex;
    const isSelected = absoluteIndex === state.selectedIndex;
    const indicator = isSelected ? '\u25CF ' : '\u25CB ';
    const color = isSelected
      ? SemanticColors.text.accent
      : SemanticColors.text.primary;

    // Use modelId if hydrated, otherwise use id
    const displayId = model.modelId || model.id;

    return (
      <Box key={`${model.provider}:${model.id}:${visibleIndex}`}>
        <Text color={color}>
          {indicator}
          {truncateModelId(displayId, modelIdWidth).padEnd(modelIdWidth)}
          {'  '}
          {!isNarrow && model.provider.padEnd(providerWidth)}
          {formatContext(model.contextWindow).padStart(ctxWidth)}
          {'  '}
          {formatCaps(model.capabilities, isNarrow).padEnd(capsWidth)}
        </Text>
      </Box>
    );
  };

  if (state.isLoading) {
    return (
      <Box
        borderStyle="round"
        borderColor={SemanticColors.border.default}
        flexDirection="column"
        padding={1}
      >
        <Text color={SemanticColors.text.primary}>Loading models...</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={width}
    >
      {/* Header */}
      <Box justifyContent="space-between" width={tableRowWidth}>
        <Text bold color={SemanticColors.text.primary}>
          Models ({state.providerFilter ?? 'all providers'})
        </Text>
        {currentProvider && (
          <Text color={SemanticColors.text.secondary}>
            {state.providerFilter === null
              ? `[^A] ${currentProvider} only`
              : '[^A] show all'}
          </Text>
        )}
      </Box>

      {/* Search bar */}
      <Box marginY={1}>
        <Text
          color={
            state.mode === 'search'
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          Search:{' '}
        </Text>
        <Text color={SemanticColors.text.primary}>{state.searchTerm}</Text>
        {state.mode === 'search' && (
          <Text color={SemanticColors.text.accent}>{'\u258C'}</Text>
        )}
        <Text color={SemanticColors.text.secondary}>
          {'  '}Found {filteredModels.length}
          {hasActiveFilters && ` of ${baselineCount}`}
        </Text>
      </Box>

      {/* Filter toggles */}
      <Box marginBottom={1}>
        <Text
          color={
            state.mode === 'filter'
              ? SemanticColors.text.primary
              : SemanticColors.text.secondary
          }
        >
          Filters:{' '}
        </Text>
        {renderFilterButton('V', state.filters.vision)}
        <Text color={SemanticColors.text.secondary}> </Text>
        {renderFilterButton('R', state.filters.reasoning)}
        {activeFilters.length > 0 && (
          <Text color={SemanticColors.text.secondary}>
            {'  '}Active: {activeFilters.join(', ')}
          </Text>
        )}
      </Box>

      {/* Table header */}
      <Box>
        <Text color={SemanticColors.text.secondary}>
          {'  '}
          {'MODEL ID'.padEnd(modelIdWidth)}
          {'  '}
          {!isNarrow && 'PROVIDER'.padEnd(providerWidth)}
          {'CTX'.padStart(ctxWidth)}
          {'  '}
          {'CAPS'.padEnd(capsWidth)}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={SemanticColors.text.secondary}>
          {'\u2500'.repeat(tableRowWidth)}
        </Text>
      </Box>

      {/* Model rows */}
      {visibleModels.length > 0 ? (
        visibleModels.map((model, i) => renderRow(model, i))
      ) : (
        <Text color={SemanticColors.text.secondary}>
          No models match your search
        </Text>
      )}

      {/* Scroll position indicator */}
      {filteredModels.length > maxRows && (
        <Box marginTop={1}>
          <Text color={SemanticColors.text.secondary}>
            Showing {state.scrollOffset + 1}-
            {Math.min(state.scrollOffset + maxRows, filteredModels.length)} of{' '}
            {filteredModels.length}
          </Text>
        </Box>
      )}

      {/* Legend */}
      <Box marginTop={1}>
        <Text color={SemanticColors.text.secondary}>
          V=vision R=reasoning (all models support tools)
        </Text>
      </Box>

      {/* Help bar */}
      <Box marginTop={1}>
        <Text color={SemanticColors.text.secondary}>
          {isNarrow
            ? `\u2191/\u2193 Enter${currentProvider ? ' ^A' : ''} Tab Esc`
            : `\u2191/\u2193 select  Enter copy ID${currentProvider ? `  ^A ${state.providerFilter === null ? currentProvider + ' only' : 'all providers'}` : ''}  Tab filters  Esc close`}
        </Text>
      </Box>
    </Box>
  );
};
