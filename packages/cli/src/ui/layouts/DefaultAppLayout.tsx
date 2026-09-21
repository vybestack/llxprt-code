/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import type {
  ContextRange,
  MessageBus,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import { Box, type DOMElement, Static, Text } from 'ink';
import type { LoadedSettings } from '../../config/settings.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import { Colors } from '../colors.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useSettingsProfileStore } from '../stores/settings/SettingsContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type {
  ScrollbackPagerStore,
  ScrollbackViewportReporter,
} from '../stores/turn/scrollbackPager.js';
import { ScrollbackViewport } from '../components/ScrollbackViewport.js';
import { SCROLLBACK_VIEWPORT_POLL_MS } from '../../constants/scrollbackLimits.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { ScrollableList } from '../components/shared/ScrollableList.js';
import { SCROLL_TO_ITEM_END } from '../components/shared/VirtualizedList.js';
import {
  renderScrollableMainContentItem,
  keyExtractorScrollableMainContentItem,
  estimateScrollableMainContentItemHeight,
  useHasActiveDialog,
  useScrollableContent,
  QuittingDisplay,
  type ScrollableMainContentItem,
} from './DefaultAppLayoutHelpers.js';
import {
  ComposerRegion,
  FooterRegion,
  DialogRegion,
  PanelsRegion,
} from './DefaultAppLayoutRegions.js';
import type { SlashCommandRuntime, UiRuntime } from '../cliUiRuntime.js';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';
import { themeManager } from '../themes/theme-manager.js';

/**
 * P02e: pager store paired with the reporter the viewport component shares
 * with it; present only when the boot-time scrollback flag was on and the
 * session journal resolved.
 */
export interface ScrollbackPagerLayoutBinding {
  readonly store: ScrollbackPagerStore;
  readonly viewport: ScrollbackViewportReporter;
}

export interface DefaultAppLayoutProps {
  runtimeMessageBus?: MessageBus;
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  settings: LoadedSettings;
  startupWarnings: string[];
  version: string;
  nightly: boolean;
  mainControlsRef: React.RefObject<DOMElement | null>;
  rootUiRef: React.RefObject<DOMElement | null>;
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;
  contextFileNames: string[];
  updateInfo: UpdateObject | null;
  scrollbackPager?: ScrollbackPagerLayoutBinding | null;
  scrollbackRestartNotice?: string | null;
}

function usesAlternateBuffer(props: DefaultAppLayoutProps): boolean {
  return (
    props.settings.merged.ui.useAlternateBuffer === true &&
    !props.uiRuntime.app.getScreenReader()
  );
}

function StreamingBoundary({ children }: React.PropsWithChildren) {
  const { store } = useTurnStore();
  const state = useStoreSelector(store, (s) => s.streamingState);
  return (
    <StreamingContext.Provider value={state}>
      {children}
    </StreamingContext.Provider>
  );
}

function QuittingBoundary({
  children,
  ...props
}: React.PropsWithChildren<DefaultAppLayoutProps>) {
  const { store } = useTurnStore();
  const quitting = useStoreSelector(store, (s) => s.quittingMessages !== null);
  return quitting ? <QuittingRegion {...props} /> : children;
}

function QuittingRegion(props: DefaultAppLayoutProps) {
  const turn = useTurnStore();
  const terminal = useTerminalStore();
  const settings = useSettingsProfileStore();
  const messages = useStoreSelector(turn.store, (s) => s.quittingMessages);
  const width = useStoreSelector(terminal.store, (s) => s.terminalWidth);
  const height = useStoreSelector(
    terminal.store,
    (s) => s.availableTerminalHeight,
  );
  const constrain = useStoreSelector(terminal.store, (s) => s.constrainHeight);
  const slashCommands = useStoreSelector(
    settings.store,
    (s) => s.slashCommands,
  );
  return (
    <QuittingDisplay
      quittingMessages={messages ?? []}
      terminalWidth={width}
      effectiveAvailableHeight={height}
      constrainHeight={constrain}
      config={props.slashCommandRuntime}
      slashCommands={slashCommands}
      showTodoPanelSetting={props.settings.merged.ui.showTodoPanel ?? true}
    />
  );
}

/** Geometry changes belong to the viewport, not its transcript owner. */
function LayoutFrame({
  children,
  ...props
}: React.PropsWithChildren<DefaultAppLayoutProps>) {
  const { store } = useTerminalStore();
  const alternate = usesAlternateBuffer(props);
  const width = useStoreSelector(store, (s) =>
    alternate ? s.terminalWidth : undefined,
  );
  const height = useStoreSelector(store, (s) =>
    alternate ? s.terminalHeight : undefined,
  );
  return (
    <Box
      flexDirection="column"
      width={alternate ? width : '90%'}
      height={height}
      flexShrink={alternate ? 0 : undefined}
      flexGrow={alternate ? 0 : undefined}
      overflow={alternate ? 'hidden' : undefined}
      ref={props.rootUiRef}
    >
      {children}
    </Box>
  );
}

/** Store subscriptions are owned by the regions below this static structure. */
export function DefaultAppLayout(
  props: DefaultAppLayoutProps,
): React.ReactNode {
  return (
    <MemoizedLayoutStructure
      {...props}
      themeName={themeManager.getActiveTheme().name}
      settingsSnapshot={props.settings.merged}
    />
  );
}

interface LayoutStructureProps extends DefaultAppLayoutProps {
  themeName: string;
  settingsSnapshot: LoadedSettings['merged'];
}

// Theme previews and mutable LoadedSettings are updated by the runtime. Keep
// those changes visible without propagating unrelated runtime hook renders.
function LayoutStructure(props: LayoutStructureProps) {
  return (
    <StreamingBoundary>
      <QuittingBoundary {...props}>
        <LayoutFrame {...props}>
          <TranscriptRegion {...props} />
          <Box
            flexDirection="column"
            ref={props.mainControlsRef}
            flexShrink={usesAlternateBuffer(props) ? 0 : undefined}
            flexGrow={usesAlternateBuffer(props) ? 0 : undefined}
          >
            <PanelsRegion {...props} />
            <DialogRegion {...props} />
            <ComposerRegion {...props} />
            <FooterRegion {...props} />
          </Box>
        </LayoutFrame>
      </QuittingBoundary>
    </StreamingBoundary>
  );
}

const MemoizedLayoutStructure = React.memo(LayoutStructure);

/** Owns transcript identity. Responsive rendering is delegated to its viewport. */
function TranscriptRegion(props: DefaultAppLayoutProps) {
  const { store } = useTurnStore();
  const history = useStoreSelector(store, (s) => s.history);
  const pendingHistoryItems = useStoreSelector(
    store,
    (s) => s.pendingHistoryItems,
  );
  const staticKey = useStoreSelector(store, (s) => s.staticKey);
  return (
    <>
      {props.scrollbackRestartNotice ? (
        <Text color={Colors.DimComment}>{props.scrollbackRestartNotice}</Text>
      ) : null}
      <TranscriptViewport
        {...props}
        history={history}
        pendingHistoryItems={pendingHistoryItems}
        staticKey={staticKey}
      />
    </>
  );
}

interface TranscriptProps extends DefaultAppLayoutProps {
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  staticKey: number;
}

function useTranscriptContent(props: TranscriptProps) {
  const { store } = useTerminalStore();
  const settings = useSettingsProfileStore();
  const terminalWidth = useStoreSelector(store, (s) => s.terminalWidth);
  const terminalHeight = useStoreSelector(store, (s) => s.terminalHeight);
  const mainAreaWidth = useStoreSelector(store, (s) => s.mainAreaWidth);
  const constrainHeight = useStoreSelector(store, (s) => s.constrainHeight);
  const availableHeight = useStoreSelector(
    store,
    (s) => s.availableTerminalHeight,
  );
  const activeShellPtyId = useStoreSelector(store, (s) => s.activeShellPtyId);
  const embeddedShellFocused = useStoreSelector(
    store,
    (s) => s.embeddedShellFocused,
  );
  const slashCommands = useStoreSelector(
    settings.store,
    (s) => s.slashCommands,
  );
  const content = useScrollableContent(
    props.slashCommandRuntime,
    props.settings,
    props.version,
    props.nightly,
    terminalWidth,
    mainAreaWidth,
    Math.max(terminalHeight * 4, 100),
    constrainHeight,
    availableHeight,
    props.settings.merged.ui.showTodoPanel ?? true,
    props.history,
    props.pendingHistoryItems,
    props.pendingHistoryItemRef,
    slashCommands,
    activeShellPtyId,
    embeddedShellFocused,
  );
  return { ...content, constrainHeight, availableHeight };
}

type HistoryServiceHandle = Parameters<
  RecordingIntegration['onHistoryServiceReplaced']
>[0];

function getInitializedHistoryService(
  uiRuntime: UiRuntime,
): HistoryServiceHandle | null {
  const agentClient = uiRuntime.agentClientSource.getAgentClient();
  if (agentClient.hasChatInitialized() !== true) {
    return null;
  }
  return agentClient.getHistoryService() ?? null;
}

/**
 * Latest context boundary snapshot (#854), or null until a HistoryService
 * exists. Mirrors the service-swap subscription pattern in
 * useTokenMetricsTracking: a poll watches for the initialized service,
 * subscribes to contextRangeChanged, and reads the current range on swap.
 */
function useContextRangeSnapshot(uiRuntime: UiRuntime): ContextRange | null {
  const [range, setRange] = useState<ContextRange | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const serviceRef = useRef<HistoryServiceHandle | null>(null);

  useEffect(() => {
    let intervalCleared = false;
    const checkInterval = setInterval(() => {
      if (intervalCleared) return;
      const historyService = getInitializedHistoryService(uiRuntime);
      if (historyService === serviceRef.current) return;
      if (cleanupRef.current !== null) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      serviceRef.current = historyService;
      if (historyService === null) {
        setRange(null);
        return;
      }
      const handleRangeChanged = (snapshot: ContextRange): void => {
        setRange(snapshot);
      };
      historyService.on('contextRangeChanged', handleRangeChanged);
      setRange(historyService.getContextRange());
      cleanupRef.current = () => {
        historyService.off('contextRangeChanged', handleRangeChanged);
      };
    }, 100);
    return () => {
      clearInterval(checkInterval);
      intervalCleared = true;
      if (cleanupRef.current !== null) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      serviceRef.current = null;
    };
  }, [uiRuntime]);

  return range;
}

function TranscriptViewport(props: TranscriptProps) {
  const {
    listItems,
    staticItems,
    pendingItems,
    constrainHeight,
    availableHeight,
  } = useTranscriptContent(props);
  const contextRange = useContextRangeSnapshot(props.uiRuntime);
  if (usesAlternateBuffer(props)) {
    const pager = props.scrollbackPager;
    if (pager) {
      return (
        <ScrollbackViewport
          store={pager.store}
          viewport={pager.viewport}
          viewportLines={Math.max(1, availableHeight)}
          pollMs={SCROLLBACK_VIEWPORT_POLL_MS}
          range={contextRange ?? undefined}
          config={props.slashCommandRuntime}
        />
      );
    }
    return <TranscriptScroll data={listItems} />;
  }
  return (
    <>
      {staticItems.length > 0 ? (
        <Static key={props.staticKey} items={staticItems}>
          {(item) => item}
        </Static>
      ) : null}
      <OverflowProvider>
        <Box ref={props.pendingHistoryItemRef} flexDirection="column">
          {pendingItems}
          <ShowMoreLines constrainHeight={constrainHeight} />
        </Box>
      </OverflowProvider>
    </>
  );
}

function TranscriptScroll({ data }: { data: ScrollableMainContentItem[] }) {
  const dialogsVisible = useHasActiveDialog();
  return (
    <ScrollableList
      hasFocus={!dialogsVisible}
      data={data}
      renderItem={renderScrollableMainContentItem}
      keyExtractor={keyExtractorScrollableMainContentItem}
      estimatedItemHeight={estimateScrollableMainContentItemHeight}
      initialScrollIndex={SCROLL_TO_ITEM_END}
      initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
    />
  );
}
