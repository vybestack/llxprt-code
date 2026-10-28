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
import { Box, type DOMElement, Text } from 'ink';
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
import { AppHeader } from '../components/AppHeader.js';
import { QuittingDisplay } from './DefaultAppLayoutHelpers.js';
import {
  ComposerRegion,
  FooterRegion,
  DialogRegion,
  PanelsRegion,
} from './DefaultAppLayoutRegions.js';
import type { SlashCommandRuntime, UiRuntime } from '../cliUiRuntime.js';
import { themeManager } from '../themes/theme-manager.js';
import { JournalStandardTranscript } from './journal-standard-transcript.js';
import { QuitBoundary } from './quit-boundary.js';

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
  return (
    <QuitBoundary
      quitting={quitting}
      quitDisplay={<QuittingRegion {...props} />}
    >
      {children}
    </QuitBoundary>
  );
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

function TranscriptRegion(props: DefaultAppLayoutProps) {
  const terminal = useTerminalStore();
  const width = useStoreSelector(
    terminal.store,
    (state) => state.terminalWidth,
  );
  return (
    <>
      {!usesAlternateBuffer(props) &&
      process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER !== 'true' ? (
        <AppHeader
          config={props.slashCommandRuntime}
          settings={props.settings}
          version={props.version}
          nightly={props.nightly}
          terminalWidth={width}
        />
      ) : null}
      <JournalTranscript {...props} />
    </>
  );
}

function JournalTranscript(props: DefaultAppLayoutProps) {
  if (!props.scrollbackPager)
    return <Text color={Colors.DimComment}>Opening session journal…</Text>;
  if (usesAlternateBuffer(props))
    return (
      <MemoizedPagerTranscript
        pager={props.scrollbackPager}
        uiRuntime={props.uiRuntime}
        slashCommandRuntime={props.slashCommandRuntime}
      />
    );
  return (
    <JournalStandardTranscript
      store={props.scrollbackPager.store}
      viewport={props.scrollbackPager.viewport}
      config={props.slashCommandRuntime}
    />
  );
}

type HistoryServiceHandle = Parameters<
  RecordingIntegration['subscribeToJournal']
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

function PagerTranscript({
  pager,
  uiRuntime,
  slashCommandRuntime,
}: {
  pager: ScrollbackPagerLayoutBinding;
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
}) {
  const contextRange = useContextRangeSnapshot(uiRuntime);
  const turn = useTurnStore();
  const pendingToolControls = useStoreSelector(
    turn.store,
    (s) => s.pendingHistoryItems,
  );
  return (
    <PagerViewport
      store={pager.store}
      viewport={pager.viewport}
      pollMs={SCROLLBACK_VIEWPORT_POLL_MS}
      range={contextRange ?? undefined}
      config={slashCommandRuntime}
      pendingToolControls={pendingToolControls}
    />
  );
}

function PagerViewport(
  props: Omit<React.ComponentProps<typeof ScrollbackViewport>, 'viewportLines'>,
) {
  const { store } = useTerminalStore();
  const height = useStoreSelector(store, (s) => s.availableTerminalHeight);
  const width = useStoreSelector(store, (s) => s.terminalWidth);
  return (
    <ScrollbackViewport
      {...props}
      viewportLines={Math.max(1, height)}
      terminalWidth={width}
    />
  );
}
const MemoizedPagerTranscript = React.memo(PagerTranscript);
