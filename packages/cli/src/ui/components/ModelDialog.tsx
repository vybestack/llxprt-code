/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core';

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
  currentProvider?: string | null;
  initialProviderFilter?: string | null;
  showAllProviders?: boolean;
}

interface ModelsDialogState {
  searchTerm: string;
  filters: CapabilityFilters;
  selectedIndex: number;
  scrollOffset: number;
  mode: 'search' | 'filter';
  providerFilter: string | null;
}

function formatContext(tokens: number | undefined): string {
  if (tokens == null || tokens === 0) return '-';
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}K`;
  return String(tokens);
}

function formatCaps(
  caps: HydratedModel['capabilities'],
  narrow: boolean,
): string {
  const letters: string[] = [];
  if (caps?.vision === true) letters.push('V');
  if (caps?.reasoning === true) letters.push('R');
  return narrow ? letters.join('') : letters.join(' ');
}

function truncateModelId(id: string, maxLen: number): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 1) + '\u2026';
}

function useModelsData(
  runtime: ReturnType<typeof useRuntimeApi>,
  providerFilter: string | null,
) {
  const supportedProviders = useMemo(() => {
    try {
      return runtime.listProviders();
    } catch {
      return [];
    }
  }, [runtime]);

  const fetchedProvidersRef = useRef<Set<string>>(new Set());
  const [allModels, setAllModels] = useState<HydratedModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      const providersToFetch = providerFilter
        ? [providerFilter]
        : supportedProviders;
      const newProviders = providersToFetch.filter(
        (p) => !fetchedProvidersRef.current.has(p),
      );

      if (newProviders.length === 0) {
        setIsLoading(false);
        return;
      }

      try {
        const results = await Promise.allSettled(
          newProviders.map((pn) => runtime.listAvailableModels(pn)),
        );
        const newModels: HydratedModel[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') newModels.push(...result.value);
        }
        if (!cancelled) {
          newProviders.forEach((p) => fetchedProvidersRef.current.add(p));
          setAllModels((prev) => {
            const seen = new Set<string>();
            return [...prev, ...newModels].filter((m) => {
              const key = `${m.provider}:${m.id}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          });
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    };

    setIsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [runtime, supportedProviders, providerFilter]);

  return { allModels, isLoading };
}

function useFilteredModels(
  allModels: HydratedModel[],
  providerFilter: string | null,
  searchTerm: string,
  filters: CapabilityFilters,
  includeDeprecated: boolean,
) {
  return useMemo(() => {
    let models = allModels;
    if (providerFilter) {
      models = models.filter((m) => m.provider === providerFilter);
    }
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      models = models.filter(
        (m) =>
          // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          m.id.toLowerCase().includes(term) ||
          m.name.toLowerCase().includes(term) ||
          (m.modelId?.toLowerCase().includes(term) ?? false) ||
          m.provider.toLowerCase().includes(term),
      );
    }
    if (filters.vision) {
      models = models.filter((m) => m.capabilities?.vision === true);
    }
    if (filters.reasoning) {
      models = models.filter((m) => m.capabilities?.reasoning === true);
    }
    models.sort((a, b) => {
      if (a.provider !== b.provider)
        return a.provider.localeCompare(b.provider);
      return a.id.localeCompare(b.id);
    });
    return models;
  }, [allModels, providerFilter, searchTerm, filters, includeDeprecated]);
}

function useBaselineCount(
  allModels: HydratedModel[],
  providerFilter: string | null,
  includeDeprecated: boolean,
) {
  return useMemo(() => {
    let models = allModels;
    if (providerFilter) {
      models = models.filter((m) => m.provider === providerFilter);
    }
    if (!includeDeprecated) {
      models = models.filter((m) => m.metadata?.status !== 'deprecated');
    }
    return models.length;
  }, [allModels, providerFilter, includeDeprecated]);
}

function handleFilterModeKeys(
  key: { name?: string; sequence?: string },
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
) {
  if (key.name === 'v' || key.sequence === 'v') {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, vision: !prev.filters.vision },
    }));
    return true;
  }
  if (key.name === 'r' || key.sequence === 'r') {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, reasoning: !prev.filters.reasoning },
    }));
    return true;
  }
  return false;
}

function handleSearchModeKeys(
  key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean },
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
) {
  if (key.name === 'backspace' || key.name === 'delete') {
    setState((prev) => ({
      ...prev,
      searchTerm: prev.searchTerm.slice(0, -1),
    }));
    return true;
  }
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    key.sequence &&
    key.sequence.length === 1 &&
    key.ctrl !== true &&
    key.meta !== true &&
    key.sequence.match(/[\x20-\x7E]/)
  ) {
    setState((prev) => ({
      ...prev,
      searchTerm: prev.searchTerm + key.sequence,
    }));
    return true;
  }
  return false;
}

function handleNavigationKeys(
  key: { name?: string },
  maxVisible: number,
  filteredModels: HydratedModel[],
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
): boolean {
  if (key.name === 'up') {
    setState((prev) => {
      const newIndex = Math.max(0, prev.selectedIndex - 1);
      const newOffset =
        newIndex < prev.scrollOffset ? newIndex : prev.scrollOffset;
      return { ...prev, selectedIndex: newIndex, scrollOffset: newOffset };
    });
    return true;
  }
  if (key.name === 'down') {
    setState((prev) => {
      const newIndex = Math.min(
        filteredModels.length - 1,
        prev.selectedIndex + 1,
      );
      const newOffset =
        newIndex >= prev.scrollOffset + maxVisible
          ? newIndex - maxVisible + 1
          : prev.scrollOffset;
      return { ...prev, selectedIndex: newIndex, scrollOffset: newOffset };
    });
    return true;
  }
  return false;
}

const SearchBar: React.FC<{
  mode: 'search' | 'filter';
  searchTerm: string;
  filteredCount: number;
  baselineCount: number;
  hasActiveFilters: boolean;
}> = ({ mode, searchTerm, filteredCount, baselineCount, hasActiveFilters }) => (
  <Box marginY={1}>
    <Text
      color={
        mode === 'search'
          ? SemanticColors.text.primary
          : SemanticColors.text.secondary
      }
    >
      Search:{' '}
    </Text>
    <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
    {mode === 'search' && (
      <Text color={SemanticColors.text.accent}>{'\u258C'}</Text>
    )}
    <Text color={SemanticColors.text.secondary}>
      {'  '}Found {filteredCount}
      {hasActiveFilters && ` of ${baselineCount}`}
    </Text>
  </Box>
);

const FilterToggles: React.FC<{
  mode: 'search' | 'filter';
  filters: CapabilityFilters;
  activeFilters: string[];
}> = ({ mode, filters, activeFilters }) => {
  const renderFilterButton = (label: string, active: boolean) => (
    <Text
      color={
        active ? SemanticColors.text.accent : SemanticColors.text.secondary
      }
    >
      [{label}]
    </Text>
  );

  return (
    <Box marginBottom={1}>
      <Text
        color={
          mode === 'filter'
            ? SemanticColors.text.primary
            : SemanticColors.text.secondary
        }
      >
        Filters:{' '}
      </Text>
      {renderFilterButton('V', filters.vision)}
      <Text color={SemanticColors.text.secondary}> </Text>
      {renderFilterButton('R', filters.reasoning)}
      {activeFilters.length > 0 && (
        <Text color={SemanticColors.text.secondary}>
          {'  '}Active: {activeFilters.join(', ')}
        </Text>
      )}
    </Box>
  );
};

const ModelTableHeader: React.FC<{
  isNarrow: boolean;
  modelIdWidth: number;
  providerWidth: number;
  ctxWidth: number;
  capsWidth: number;
  tableRowWidth: number;
}> = ({
  isNarrow,
  modelIdWidth,
  providerWidth,
  ctxWidth,
  capsWidth,
  tableRowWidth,
}) => (
  <>
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
  </>
);

const ModelRows: React.FC<{
  visibleModels: HydratedModel[];
  scrollOffset: number;
  selectedIndex: number;
  isNarrow: boolean;
  modelIdWidth: number;
  providerWidth: number;
  ctxWidth: number;
  capsWidth: number;
}> = ({
  visibleModels,
  scrollOffset,
  selectedIndex,
  isNarrow,
  modelIdWidth,
  providerWidth,
  ctxWidth,
  capsWidth,
}) => {
  if (visibleModels.length === 0) {
    return (
      <Text color={SemanticColors.text.secondary}>
        No models match your search
      </Text>
    );
  }

  return (
    <>
      {visibleModels.map((model, i) => {
        const absoluteIndex = scrollOffset + i;
        const isSelected = absoluteIndex === selectedIndex;
        const indicator = isSelected ? '\u25CF ' : '\u25CB ';
        const color = isSelected
          ? SemanticColors.text.accent
          : SemanticColors.text.primary;

        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string modelId fallback to id
        const displayId = model.modelId || model.id;

        return (
          <Box key={`${model.provider}:${model.id}:${i}`}>
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
      })}
    </>
  );
};

const ScrollIndicator: React.FC<{
  filteredCount: number;
  scrollOffset: number;
  maxRows: number;
}> = ({ filteredCount, scrollOffset, maxRows }) => {
  if (filteredCount <= maxRows) return null;

  return (
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>
        Showing {scrollOffset + 1}-
        {Math.min(scrollOffset + maxRows, filteredCount)} of {filteredCount}
      </Text>
    </Box>
  );
};

const HelpBar: React.FC<{
  isNarrow: boolean;
  currentProvider: string | null;
  providerFilter: string | null;
}> = ({ isNarrow, currentProvider, providerFilter }) => (
  <Box marginTop={1}>
    <Text color={SemanticColors.text.secondary}>
      {/* eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice. */}
      {isNarrow
        ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          `\u2191/\u2193 Enter${currentProvider ? ' ^A' : ''} Tab Esc`
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          `\u2191/\u2193 select  Enter copy ID${currentProvider ? `  ^A ${providerFilter === null ? currentProvider + ' only' : 'all providers'}` : ''}  Tab filters  Esc close`}
    </Text>
  </Box>
);

const ModelsDialogHeader: React.FC<{
  providerFilter: string | null;
  currentProvider: string | null;
  tableRowWidth: number;
}> = ({ providerFilter, currentProvider, tableRowWidth }) => (
  <Box justifyContent="space-between" width={tableRowWidth}>
    <Text bold color={SemanticColors.text.primary}>
      Models ({providerFilter ?? 'all providers'})
    </Text>
    {currentProvider && (
      <Text color={SemanticColors.text.secondary}>
        {providerFilter === null
          ? `[^A] ${currentProvider} only`
          : '[^A] show all'}
      </Text>
    )}
  </Box>
);

function handleEscapeKey(
  searchTerm: string,
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
  onClose: () => void,
) {
  if (searchTerm.length > 0) {
    setState((prev) => ({ ...prev, searchTerm: '' }));
  } else {
    onClose();
  }
}

function handleTabKey(
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
) {
  setState((prev) => ({
    ...prev,
    mode: prev.mode === 'search' ? 'filter' : 'search',
  }));
}

function handleCtrlAKey(
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
  currentProvider: string,
) {
  setState((prev) => ({
    ...prev,
    providerFilter: prev.providerFilter === null ? currentProvider : null,
    selectedIndex: 0,
    scrollOffset: 0,
  }));
}

function useModelsKeypress(
  state: ModelsDialogState,
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
  filteredModels: HydratedModel[],
  onClose: () => void,
  onSelect: (model: HydratedModel) => void,
  currentProvider: string | null,
) {
  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      if (key.name === 'escape') {
        handleEscapeKey(state.searchTerm, setState, onClose);
        return;
      }
      if (key.name === 'tab') {
        handleTabKey(setState);
        return;
      }
      if (key.name === 'a' && key.ctrl === true && currentProvider != null) {
        handleCtrlAKey(setState, currentProvider);
        return;
      }
      if (key.name === 'return' && filteredModels.length > 0) {
        onSelect(filteredModels[state.selectedIndex]);
        return;
      }
      if (handleNavigationKeys(key, 15, filteredModels, setState)) {
        return;
      }
      if (state.mode === 'filter') {
        handleFilterModeKeys(key, setState);
        return;
      }
      handleSearchModeKeys(key, setState);
    },
    [state, setState, filteredModels, onClose, onSelect, currentProvider],
  );

  useKeypress(handleKeypress, { isActive: true });
}

function useColumnWidths(
  filteredModels: HydratedModel[],
  isNarrow: boolean,
  width: number,
) {
  const providerWidth = isNarrow ? 0 : 14;
  const ctxWidth = 10;
  const capsWidth = isNarrow ? 5 : 10;
  const fixedWidth = 2 + 2 + providerWidth + ctxWidth + 2 + capsWidth + 4;

  const maxModelIdLen = useMemo(() => {
    if (filteredModels.length === 0) return 20;
    return Math.max(
      ...filteredModels.map(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string modelId fallback to id
        (m) => (m.modelId || m.id).length,
      ),
    );
  }, [filteredModels]);

  const availableForModelId = Math.max(20, width - fixedWidth - 6);
  const modelIdWidth = Math.min(maxModelIdLen, availableForModelId);

  const tableRowWidth =
    2 +
    modelIdWidth +
    2 +
    (isNarrow ? 0 : providerWidth) +
    ctxWidth +
    2 +
    capsWidth;

  return { providerWidth, ctxWidth, capsWidth, modelIdWidth, tableRowWidth };
}

function useActiveFilters(filters: CapabilityFilters): string[] {
  return useMemo(() => {
    const active: string[] = [];
    if (filters.vision) active.push('V');
    if (filters.reasoning) active.push('R');
    return active;
  }, [filters]);
}

function useDialogState(
  initialSearch: string,
  initialFilters: Partial<CapabilityFilters>,
  computedInitialFilter: string | null,
) {
  return useState<ModelsDialogState>({
    searchTerm: initialSearch,
    filters: {
      vision: initialFilters.vision ?? false,
      reasoning: initialFilters.reasoning ?? false,
    },
    selectedIndex: 0,
    scrollOffset: 0,
    mode: 'search',
    providerFilter: computedInitialFilter,
  });
}

function useDerivedModelsData(
  runtime: ReturnType<typeof useRuntimeApi>,
  state: ModelsDialogState,
  includeDeprecated: boolean,
) {
  const { allModels, isLoading } = useModelsData(runtime, state.providerFilter);
  const filteredModels = useFilteredModels(
    allModels,
    state.providerFilter,
    state.searchTerm,
    state.filters,
    includeDeprecated,
  );
  const baselineCount = useBaselineCount(
    allModels,
    state.providerFilter,
    includeDeprecated,
  );
  return { filteredModels, baselineCount, isLoading };
}

function useResetModelSelectionOnFilterChange(
  state: ModelsDialogState,
  setState: React.Dispatch<React.SetStateAction<ModelsDialogState>>,
): void {
  useEffect(() => {
    setState((prev) => ({ ...prev, selectedIndex: 0, scrollOffset: 0 }));
  }, [state.searchTerm, state.filters, state.providerFilter, setState]);
}

const ModelsDialogBody: React.FC<{
  state: ModelsDialogState;
  isNarrow: boolean;
  width: number;
  filteredModels: HydratedModel[];
  baselineCount: number;
  hasActiveFilters: boolean;
  currentProvider: string | null;
  activeFilters: string[];
  modelIdWidth: number;
  providerWidth: number;
  ctxWidth: number;
  capsWidth: number;
  tableRowWidth: number;
  maxRows: number;
  visibleModels: HydratedModel[];
}> = ({
  state,
  isNarrow,
  width,
  filteredModels,
  baselineCount,
  hasActiveFilters,
  currentProvider,
  activeFilters,
  modelIdWidth,
  providerWidth,
  ctxWidth,
  capsWidth,
  tableRowWidth,
  maxRows,
  visibleModels,
}) => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
    width={width}
  >
    <ModelsDialogHeader
      providerFilter={state.providerFilter}
      currentProvider={currentProvider}
      tableRowWidth={tableRowWidth}
    />
    <SearchBar
      mode={state.mode}
      searchTerm={state.searchTerm}
      filteredCount={filteredModels.length}
      baselineCount={baselineCount}
      hasActiveFilters={hasActiveFilters}
    />
    <FilterToggles
      mode={state.mode}
      filters={state.filters}
      activeFilters={activeFilters}
    />
    <ModelTableHeader
      isNarrow={isNarrow}
      modelIdWidth={modelIdWidth}
      providerWidth={providerWidth}
      ctxWidth={ctxWidth}
      capsWidth={capsWidth}
      tableRowWidth={tableRowWidth}
    />
    <ModelRows
      visibleModels={visibleModels}
      scrollOffset={state.scrollOffset}
      selectedIndex={state.selectedIndex}
      isNarrow={isNarrow}
      modelIdWidth={modelIdWidth}
      providerWidth={providerWidth}
      ctxWidth={ctxWidth}
      capsWidth={capsWidth}
    />
    <ScrollIndicator
      filteredCount={filteredModels.length}
      scrollOffset={state.scrollOffset}
      maxRows={maxRows}
    />
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>
        V=vision R=reasoning (all models support tools)
      </Text>
    </Box>
    <HelpBar
      isNarrow={isNarrow}
      currentProvider={currentProvider}
      providerFilter={state.providerFilter}
    />
  </Box>
);

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

  const computedInitialFilter = useMemo(() => {
    if (showAllProviders) return null;
    if (initialProviderFilter !== undefined) return initialProviderFilter;
    return currentProvider ?? null;
  }, [showAllProviders, initialProviderFilter, currentProvider]);

  const [state, setState] = useDialogState(
    initialSearch,
    initialFilters,
    computedInitialFilter,
  );

  const { filteredModels, baselineCount, isLoading } = useDerivedModelsData(
    runtime,
    state,
    includeDeprecated,
  );

  const activeFilters = useActiveFilters(state.filters);
  const hasActiveFilters =
    state.searchTerm.length > 0 || activeFilters.length > 0;

  useResetModelSelectionOnFilterChange(state, setState);

  useModelsKeypress(
    state,
    setState,
    filteredModels,
    onClose,
    onSelect,
    currentProvider,
  );

  const { providerWidth, ctxWidth, capsWidth, modelIdWidth, tableRowWidth } =
    useColumnWidths(filteredModels, isNarrow, width);

  const maxRows = 15;
  const visibleModels = filteredModels.slice(
    state.scrollOffset,
    state.scrollOffset + maxRows,
  );

  if (isLoading) {
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
    <ModelsDialogBody
      state={state}
      isNarrow={isNarrow}
      width={width}
      filteredModels={filteredModels}
      baselineCount={baselineCount}
      hasActiveFilters={hasActiveFilters}
      currentProvider={currentProvider}
      activeFilters={activeFilters}
      modelIdWidth={modelIdWidth}
      providerWidth={providerWidth}
      ctxWidth={ctxWidth}
      capsWidth={capsWidth}
      tableRowWidth={tableRowWidth}
      maxRows={maxRows}
      visibleModels={visibleModels}
    />
  );
};
