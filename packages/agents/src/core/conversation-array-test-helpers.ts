/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnershipStats } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { ConversationManager } from './ConversationManager.js';
import { installModelToolFixture } from './__tests__/model-tool-fixture.js';
import { conversationWithOwners } from './conversation-array-core-helpers.js';

export {
  forbidArrayRollback,
  gate,
  recordArrayProof,
} from './conversation-array-core-helpers.js';

const selectTools = installModelToolFixture();

export function conversationFor(history: HistoryService): ConversationManager {
  return conversationWithOwners(history, {
    telemetryFor: (config) =>
      createSessionSettingsFixture(config).settingsOwner.telemetry,
    selectTools,
  });
}

export function boundedOwners(stats: RowOwnershipStats): boolean {
  return stats.liveRows <= 440 && stats.liveSerializedBytes <= 8 * 1024 * 1024;
}

export function expectBatchObserverOwners(
  stats: RowOwnershipStats,
  size: number,
  retain: boolean,
): void {
  if (retain) {
    expect(stats.liveRows).toBeGreaterThanOrEqual(size);
    expect(stats.liveSerializedBytes).toBeGreaterThan(
      size === 8192 ? 8 * 1024 * 1024 : size * 2048,
    );
  } else {
    expect(stats.liveRows).toBeLessThanOrEqual(3);
    expect(boundedOwners(stats)).toBe(true);
  }
}
