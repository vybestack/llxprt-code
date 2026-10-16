/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { DEFAULT_HISTORY_MAX_ITEMS } from '../../constants/historyLimits.js';
import { historyLimitsFromSettings } from './historyLimitsFromSettings.js';
import { resumeOwnerSession } from './resumeOwnerSession.js';
import { resumeHistoryWindow } from './streamHistoryItems.js';

const ROWS = 2000;

function settingsWith(ui: { historyMaxItems?: number }): {
  merged: { ui: { historyMaxItems?: number } };
} {
  return { merged: { ui } };
}

function humanRows(count: number): IContent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    speaker: 'human' as const,
    blocks: [{ type: 'text' as const, text: `turn ${index}` }],
  }));
}

describe('resume transcript window honors the configured history limits', () => {
  it('keeps every resumed row when historyMaxItems covers them', async () => {
    const limits = historyLimitsFromSettings(
      settingsWith({ historyMaxItems: ROWS }),
    );

    const items = await resumeHistoryWindow(
      humanRows(ROWS),
      'allowed',
      undefined,
      limits,
    );

    expect(items).toHaveLength(ROWS);
    expect(items.at(-1)).toMatchObject({ text: `turn ${ROWS - 1}` });
  });

  it('keeps the default window when historyMaxItems is unset', async () => {
    const limits = historyLimitsFromSettings(settingsWith({}));

    const items = await resumeHistoryWindow(
      humanRows(ROWS),
      'allowed',
      undefined,
      limits,
    );

    expect(items).toHaveLength(DEFAULT_HISTORY_MAX_ITEMS);
    expect(items.at(-1)).toMatchObject({ text: `turn ${ROWS - 1}` });
  });

  it('applies the configured limit to an owner-session resume', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      await agent.setHistory(humanRows(ROWS));
      await agent.session.setRecording({ enabled: true });
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('No source session');
      await agent.session.setRecording({ enabled: false });
      const next = await borrow();

      const configured = await resumeOwnerSession(
        next,
        sourceId,
        'allowed',
        historyLimitsFromSettings(settingsWith({ historyMaxItems: ROWS })),
      );

      expect(configured.uiHistory).toHaveLength(ROWS);
    });
  }, 60000);
});
