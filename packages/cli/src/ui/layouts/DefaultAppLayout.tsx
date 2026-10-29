/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { ContextRange } from '@vybestack/llxprt-code-core';
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
import type {
  AgentAuthControl,
  AgentHookControl,
} from '@vybestack/llxprt-code-agents';
import type { LayoutRuntime } from './DefaultAppLayoutHelpers.js';
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
  readIdeMode: () => boolean;
  readIdeDiffingEnabled: () => boolean | null;
  subscribeIdeDiffing: (listener: () => void) => () => void;
  resolveIdeDiff: (
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ) => Promise<void>;
  readIdeWorkspaceTrust: () => boolean | undefined;
  subscribeIdeWorkspaceTrust: (
    listener: (trusted: boolean | undefined) => void,
  ) => () => void;

  subscribeBucketConsent?: AgentAuthControl['subscribeBucketConsent'];
  respondToBucketConsent?: AgentAuthControl['respondToBucketConsent'];
  subscribeHookPhase?: AgentHookControl['subscribeExecutionPhase'];
  screenReaderEnabled: boolean;
  disableLoadingPhrases: boolean;
  debugMode: boolean;
  layoutRuntime: LayoutRuntime;
  subscribeContextRange: (publish: (range: ContextRange) => void) => () => void;
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
    !props.screenReaderEnabled
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
      config={props.layoutRuntime}
      readIdeMode={props.readIdeMode}
      readIdeDiffingEnabled={props.readIdeDiffingEnabled}
      subscribeIdeDiffing={props.subscribeIdeDiffing}
      resolveIdeDiff={props.resolveIdeDiff}
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

function TranscriptHeader(props: DefaultAppLayoutProps) {
  const terminal = useTerminalStore();
  const width = useStoreSelector(
    terminal.store,
    (state) => state.terminalWidth,
  );
  return (
    <AppHeader
      config={props.layoutRuntime}
      settings={props.settings}
      version={props.version}
      nightly={props.nightly}
      terminalWidth={width}
    />
  );
}

function TranscriptRegion(props: DefaultAppLayoutProps) {
  const header = React.useMemo(
    () =>
      process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER !== 'true' ? (
        <TranscriptHeader {...props} />
      ) : null,
    [props],
  );
  return <JournalTranscript {...props} header={header} />;
}

function JournalTranscript(
  props: DefaultAppLayoutProps & { header: React.ReactNode },
) {
  const turn = useTurnStore();
  const staticKey = useStoreSelector(turn.store, (state) => state.staticKey);
  if (!props.scrollbackPager)
    return (
      <Box flexDirection="column">
        {props.header}
        <Text color={Colors.DimComment}>Opening session journal…</Text>
      </Box>
    );
  if (usesAlternateBuffer(props))
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
        justifyContent="flex-end"
      >
        <MemoizedPagerTranscript
          pager={props.scrollbackPager}
          {...props}
          header={props.header}
        />
      </Box>
    );
  return (
    <JournalStandardTranscript
      key={staticKey}
      store={props.scrollbackPager.store}
      viewport={props.scrollbackPager.viewport}
      rendering={{ config: props.layoutRuntime, ...props }}
      header={props.header}
    />
  );
}

function useContextRangeSnapshot(
  subscribe: DefaultAppLayoutProps['subscribeContextRange'],
): ContextRange | null {
  const [range, setRange] = useState<ContextRange | null>(null);
  useEffect(() => subscribe(setRange), [subscribe]);
  return range;
}

function PagerTranscript({
  pager,
  subscribeContextRange,
  layoutRuntime,
  readIdeMode,
  readIdeDiffingEnabled,
  subscribeIdeDiffing,
  resolveIdeDiff,
  header,
}: {
  pager: ScrollbackPagerLayoutBinding;
  subscribeContextRange: DefaultAppLayoutProps['subscribeContextRange'];
  layoutRuntime: LayoutRuntime;
  readIdeMode: DefaultAppLayoutProps['readIdeMode'];
  readIdeDiffingEnabled: DefaultAppLayoutProps['readIdeDiffingEnabled'];
  subscribeIdeDiffing: DefaultAppLayoutProps['subscribeIdeDiffing'];
  resolveIdeDiff: DefaultAppLayoutProps['resolveIdeDiff'];
  header: React.ReactNode;
}) {
  const contextRange = useContextRangeSnapshot(subscribeContextRange);
  const turn = useTurnStore();
  const showClearNotice = useStoreSelector(
    turn.store,
    (state) => state.historyEpoch > 0,
  );
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
      rendering={{
        config: layoutRuntime,
        readIdeMode,
        readIdeDiffingEnabled,
        subscribeIdeDiffing,
        resolveIdeDiff,
      }}
      pendingToolControls={pendingToolControls}
      header={header}
      showClearNotice={showClearNotice}
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
