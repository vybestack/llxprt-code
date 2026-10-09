/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
  rowsOf,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import { HistoryMediaOwnership } from '../../packages/core/src/storage/history-media-ownership.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import { DetachedHistoryJournal } from '../../packages/core/src/services/history/detachedHistoryJournal.js';
import type {
  IContent,
  MediaReferenceBlock,
  ChronologyMarker,
} from '../../packages/core/src/services/history/IContent.js';
import type { ContextRange } from '../../packages/core/src/services/history/historyEventTypes.js';
import type { ProviderFallbackCandidate } from '../../packages/agents/src/compression/providerFallbackCandidate.js';
import { ProviderContentEnforcer } from '../../packages/agents/src/compression/providerContentEnforcement.js';
import { applyPendingWindowFallback } from '../../packages/agents/src/compression/pendingWindowFallback.js';
import { buildRuntimeContext } from '../../packages/agents/src/core/__tests__/chatSession-density-helpers.js';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

interface RawState {
  rows: IContent[];
  ordinals: Array<ChronologyMarker | undefined>;
  tokens: number;
  offset: number;
  anchor: number;
  range: ContextRange;
  baseline: number | null;
  priorReserved: boolean;
  nextReserved: boolean;
}
export interface TransactionFixture {
  history: HistoryService;
  recorder: AdmissionFailureRecorder;
  owners: RowOwnership;
  store: LocalMediaStore;
  owner: HistoryMediaOwnership;
  prior: MediaReferenceBlock;
  next: MediaReferenceBlock;
  candidate: DetachedHistoryJournal;
  state: {
    baseline: number | null;
    installed: boolean;
    projectionsAfterInstall: number;
  };
  installedState(): RawState;
  rememberInstalled(value: RawState): void;
}

export async function transactionFixture<T>(
  execute: (fixture: TransactionFixture) => Promise<T>,
): Promise<T> {
  const fixture = await createFixture();
  try {
    return await execute(fixture);
  } finally {
    fixture.candidate.close();
    fixture.history.dispose();
    await fixture.recorder.dispose();
    await fixture.owner.releaseAll();
    await fixture.store.close();
  }
}

async function seedOriginal(
  history: HistoryService,
  recorder: AdmissionFailureRecorder,
  owner: HistoryMediaOwnership,
  prior: MediaReferenceBlock,
): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original' }, prior],
    metadata: { cacheAnchor: true },
  });
  await history.waitForCommit();
  await recorder.commit('content', {
    content: {
      speaker: 'ai',
      blocks: [],
      metadata: { chronology: { seq: 2, userTurn: 1, step: 2, recordedAt: 0 } },
    },
  });
  history.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'original response' }],
    metadata: { chronology: { seq: 3, userTurn: 1, step: 3, recordedAt: 0 } },
  });
  await history.waitForCommit();
  await history.waitForTokenUpdates();
  history.setBaseTokenOffset(37);
  history.syncTotalTokens(913);
  await history.waitForTokenUpdates();
  history.setCacheAnchorSeq(1);
  const original = await rowsOf(history);
  await owner.reconcile([], () => original);
}

async function createFixture(): Promise<TransactionFixture> {
  const root = mkdtempSync(join(tmpdir(), 'rejected-transaction-'));
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'rejected',
    projectHash: 'rejected',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const owners = new RowOwnership();
  const history = new HistoryService({
    recording: recorder,
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  const store = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const owner = new HistoryMediaOwnership(store);
  history.registerMediaOwner(owner);
  const prior = await store.admit({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const next = await store.admit({
    bytes: new Uint8Array([2]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  await seedOriginal(history, recorder, owner, prior);
  const candidate = new DetachedHistoryJournal(owners);
  candidate.append({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'candidate' }, next],
  });
  const state: TransactionFixture['state'] = {
    baseline: 123,
    installed: false,
    projectionsAfterInstall: 0,
  };
  let installed: RawState | undefined;
  return {
    history,
    recorder,
    owners,
    store,
    owner,
    prior,
    next,
    candidate,
    state,
    rememberInstalled: (value) => {
      installed = value;
    },
    installedState: () => {
      if (installed === undefined) throw new Error('Missing installed state');
      return installed;
    },
  };
}

export type Rejection =
  | 'false'
  | 'throw'
  | 'restore-admission'
  | 'restore-baseline';
export const rejection = new Error('external rejection after installation');
export const baselineFailure = new Error('baseline restoration failed');
export const logger = new DebugLogger('test:rejected-transaction');
export const pending: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
];

export async function bodyFor(
  rows: IContent[],
  store: LocalMediaStore,
): Promise<string> {
  return captureCuratedBody(
    'anthropic',
    rows,
    true,
    false,
    false,
    undefined,
    new RequestMediaResolver(store),
  );
}
export async function rawState(fixture: TransactionFixture): Promise<RawState> {
  const rows = await rowsOf(fixture.history);
  return {
    rows,
    ordinals: rows.map((row) => row.metadata?.chronology),
    tokens: fixture.history.getTotalTokens(),
    offset: fixture.history.getBaseTokenOffset(),
    anchor: fixture.history.getCacheAnchorSeq(),
    range: fixture.history.getContextRange(),
    baseline: fixture.state.baseline,
    priorReserved: await fixture.store.hasReservations(fixture.prior.contentId),
    nextReserved: await fixture.store.hasReservations(fixture.next.contentId),
  };
}

export async function runRejection(
  fixture: TransactionFixture,
  route: 'provider' | 'pending',
  kind: Rejection,
): Promise<unknown> {
  const { history, recorder, candidate, state } = fixture;
  const install = async (
    _prompt: string,
    publish: (candidate: ProviderFallbackCandidate) => Promise<void>,
  ): Promise<boolean> => {
    await publish({ rows: candidate, start: 0, hasPendingRows: false });
    state.installed = true;
    fixture.rememberInstalled(await rawState(fixture));
    if (kind === 'restore-admission') recorder.failAdmissionAfter(1);
    if (kind !== 'false') throw rejection;
    return false;
  };
  const restoreBaseline = (value: number | null): void => {
    if (kind === 'restore-baseline') throw baselineFailure;
    state.baseline = value;
  };
  try {
    if (route === 'pending') {
      return await applyPendingWindowFallback(
        {
          historyService: history,
          getRuntimeModel: () => 'test',
          getLastPromptTokenCount: () => state.baseline,
          resetLastPromptTokenCount: () => {
            state.baseline = 0;
          },
          restoreLastPromptTokenCount: restoreBaseline,
          performFallbackCompression: install,
        },
        'reject',
        0,
      );
    }
    const enforcer = new ProviderContentEnforcer({
      historyService: history,
      runtimeContext: buildRuntimeContext(history, {
        contextLimit: 30000,
        compressionThreshold: 0.8,
      }),
      generationConfig: { maxOutputTokens: 100 },
      providerRuntimeNullable: undefined,
      logger,
      ensureDensityOptimized: async () => {},
      performCompression: async () => PerformCompressionResult.FAILED,
      performFallbackCompression: install,
      getPromptTokenBaseline: () => state.baseline,
      resetPromptTokenBaseline: () => {
        state.baseline = 0;
      },
      restorePromptTokenBaseline: restoreBaseline,
      estimateFinalizedPromptTokens: async (rows) => {
        if (state.installed) state.projectionsAfterInstall++;
        return rows.length + (state.installed ? 0 : 200000);
      },
    });
    return await enforcer.enforce(
      { contents: pending, pendingContents: pending },
      'reject',
    );
  } catch (error) {
    return error;
  }
}
