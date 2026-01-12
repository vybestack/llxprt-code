/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  getModelsRegistry,
  initializeModelsRegistry,
  type LlxprtModel,
} from '@vybestack/llxprt-code-core';
import { loadProviderAliasEntries } from '../../providers/providerAliases.js';

export interface CapabilityFilters {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  audio: boolean;
}

export interface ModelsDialogProps {
  onSelect: (model: LlxprtModel) => void;
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
  allModels: LlxprtModel[];
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

// Format capabilities as letters
function formatCaps(
  caps: LlxprtModel['capabilities'],
  narrow: boolean,
): string {
  const letters: string[] = [];
  if (caps?.toolCalling) letters.push('T');
  if (caps?.vision) letters.push('V');
  if (caps?.reasoning) letters.push('R');
  if (caps?.audio) letters.push('A');
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

  // Build mapping from our provider names to models.dev provider IDs
  const providerToModelsDevId = useMemo(() => {
    const mapping = new Map<string, string | null>();
    try {
      const aliases = loadProviderAliasEntries();
      for (const entry of aliases) {
        const name = entry.config.name || entry.alias;
        const modelsDevId = entry.config.modelsDevProviderId ?? null;
        mapping.set(name, modelsDevId);
      }
    } catch {
      // Ignore errors loading aliases
    }
    return mapping;
  }, []);

  // Get all unique modelsDevProviderIds for our supported providers
  const supportedModelsDevIds = useMemo(() => {
    const ids = new Set<string>();
    for (const providerName of supportedProviders) {
      const modelsDevId = providerToModelsDevId.get(providerName);
      if (modelsDevId) {
        ids.add(modelsDevId);
      }
    }
    return ids;
  }, [supportedProviders, providerToModelsDevId]);

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
      tools: initialFilters.tools ?? false,
      vision: initialFilters.vision ?? false,
      reasoning: initialFilters.reasoning ?? false,
      audio: initialFilters.audio ?? false,
    },
    selectedIndex: 0,
    scrollOffset: 0,
    mode: 'search',
    allModels: [],
    isLoading: true,
    providerFilter: computedInitialFilter,
  });

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        await initializeModelsRegistry();
        const registry = getModelsRegistry();
        const models = registry.getAll();
        setState((prev) => ({
          ...prev,
          allModels: models,
          isLoading: false,
        }));
      } catch {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    };
    loadModels();
  }, []);

  // Filter models based on search and capability filters
  const filteredModels = useMemo(() => {
    let models = state.allModels;

    // 1. Only supported providers - filter by modelsDevProviderIds
    if (supportedModelsDevIds.size > 0) {
      models = models.filter((m) => supportedModelsDevIds.has(m.providerId));
    }

    // 2. Provider filter - map our provider name to modelsDevProviderId
    if (state.providerFilter) {
      const modelsDevId = providerToModelsDevId.get(state.providerFilter);
      if (modelsDevId) {
        models = models.filter((m) => m.providerId === modelsDevId);
      } else {
        // Fallback: try direct match (for backward compatibility)
        models = models.filter((m) => m.providerId === state.providerFilter);
      }
    }

    // 3. Filter deprecated
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }

    // 4. Filter by search term
    if (state.searchTerm) {
      const term = state.searchTerm.toLowerCase();
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(term) ||
          m.name.toLowerCase().includes(term) ||
          m.modelId.toLowerCase().includes(term) ||
          m.providerId.toLowerCase().includes(term),
      );
    }

    // 5. Filter by capabilities (AND logic)
    if (state.filters.tools) {
      models = models.filter((m) => m.capabilities?.toolCalling);
    }
    if (state.filters.vision) {
      models = models.filter((m) => m.capabilities?.vision);
    }
    if (state.filters.reasoning) {
      models = models.filter((m) => m.capabilities?.reasoning);
    }
    if (state.filters.audio) {
      models = models.filter((m) => m.capabilities?.audio);
    }

    // Sort by provider, then model ID
    models.sort((a, b) => {
      if (a.providerId !== b.providerId) {
        return a.providerId.localeCompare(b.providerId);
      }
      return a.modelId.localeCompare(b.modelId);
    });

    return models;
  }, [
    state.allModels,
    state.providerFilter,
    state.searchTerm,
    state.filters,
    includeDeprecated,
    supportedModelsDevIds,
    providerToModelsDevId,
  ]);

  // Reset selection and scroll when filters change
  useEffect(() => {
    setState((prev) => ({ ...prev, selectedIndex: 0, scrollOffset: 0 }));
  }, [state.searchTerm, state.filters, state.providerFilter]);

  // Get active filter names for display
  const activeFilters = useMemo(() => {
    const active: string[] = [];
    if (state.filters.tools) active.push('T');
    if (state.filters.vision) active.push('V');
    if (state.filters.reasoning) active.push('R');
    if (state.filters.audio) active.push('A');
    return active;
  }, [state.filters]);

  // Baseline count: models after provider + deprecated filters, before search/caps
  const baselineCount = useMemo(() => {
    let models = state.allModels;

    // 1. Only supported providers
    if (supportedModelsDevIds.size > 0) {
      models = models.filter((m) => supportedModelsDevIds.has(m.providerId));
    }

    // 2. Provider filter
    if (state.providerFilter) {
      const modelsDevId = providerToModelsDevId.get(state.providerFilter);
      if (modelsDevId) {
        models = models.filter((m) => m.providerId === modelsDevId);
      } else {
        models = models.filter((m) => m.providerId === state.providerFilter);
      }
    }

    // 3. Filter deprecated
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }

    return models.length;
  }, [
    state.allModels,
    state.providerFilter,
    includeDeprecated,
    supportedModelsDevIds,
    providerToModelsDevId,
  ]);

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

      // Filter mode: toggle filters with letter keys
      if (state.mode === 'filter') {
        if (key.name === 't' || key.sequence === 't') {
          setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, tools: !prev.filters.tools },
          }));
          return;
        }
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
        if (key.name === 'a' || key.sequence === 'a') {
          setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, audio: !prev.filters.audio },
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
    return Math.max(...filteredModels.map((m) => m.modelId.length));
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
  const renderRow = (model: LlxprtModel, visibleIndex: number) => {
    const absoluteIndex = state.scrollOffset + visibleIndex;
    const isSelected = absoluteIndex === state.selectedIndex;
    const indicator = isSelected ? '\u25CF ' : '\u25CB ';
    const color = isSelected
      ? SemanticColors.text.accent
      : SemanticColors.text.primary;

    return (
      <Box key={model.id}>
        <Text color={color}>
          {indicator}
          {truncateModelId(model.modelId, modelIdWidth).padEnd(modelIdWidth)}
          {'  '}
          {!isNarrow && model.providerId.padEnd(providerWidth)}
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
          {state.mode === 'search' && (
            <Text color={SemanticColors.text.accent}>{'\u258C'}</Text>
          )}
        </Text>
        <Text color={SemanticColors.text.primary}>{state.searchTerm}</Text>
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
        {renderFilterButton('T', state.filters.tools)}
        <Text color={SemanticColors.text.secondary}> </Text>
        {renderFilterButton('V', state.filters.vision)}
        <Text color={SemanticColors.text.secondary}> </Text>
        {renderFilterButton('R', state.filters.reasoning)}
        <Text color={SemanticColors.text.secondary}> </Text>
        {renderFilterButton('A', state.filters.audio)}
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
          T=tools V=vision R=reasoning A=audio
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
