/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import type { Harness } from './default-app-layout.cap.test.js';
import type { HistoryItem } from '../types.js';
import { encodeJournalUiItem } from '../stores/turn/journal-ui-item.js';
import {
  count,
  message,
  sizedMessage,
  serializedBytes,
} from './cap-payload.fixture.js';

type Layout = (
  history: HistoryItem[],
  maxItems: number,
  run: (harness: Harness) => Promise<void>,
  header?: boolean,
  screenReader?: boolean,
  captureTerminal?: boolean,
) => Promise<void>;

function registerScenario0(withLayout: Layout): void {
  it('refreshes a replaced display relation with rendered markdown and no stale revision', async () => {
    await withLayout(
      [],
      10,
      async ({ writer, update, pager, turn, session }) => {
        const descriptor = {
          type: 'tool-result',
          attemptId: '',
          callId: 'cap-call',
          format: 'text',
          status: 'Success',
          displayName: 'cap_tool',
          renderOutputAsMarkdown: true,
        } satisfies Parameters<typeof writer.append>[0];
        const first = await update(async () => {
          await session.append([
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'cap-call',
                  name: 'cap_tool',
                  parameters: {},
                },
              ],
            },
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'cap-call',
                  toolName: 'cap_tool',
                  result: 'model result',
                },
              ],
            },
          ]);
          await writer.append(descriptor, '**OLD_RELATION3434**');
          await pager.invalidate();
          await pager.resumeFromJournal();
          turn.commands.refreshStatic();
        });
        expect(first.text).toContain('OLD_RELATION3434');
        await update(async () => {
          await writer.append(descriptor, '**UPDATED_RELATION3434**');
        });
        const refreshed = await update(async () => {
          await pager.invalidate();
          await pager.resumeFromJournal();
          turn.commands.refreshStatic();
        });
        expect(count(refreshed.text, 'UPDATED_RELATION3434')).toBe(1);
        expect(refreshed.text).not.toContain('**UPDATED_RELATION3434**');
        expect(refreshed.text).not.toContain('OLD_RELATION3434');
      },
    );
  });
}

function registerScenario1(withLayout: Layout): void {
  it('replaces the tail and removes the head in one operation without replaying surviving rows', async () => {
    await withLayout([], 10, async ({ writer, update, pager, turn }) => {
      const head = await writer.append(
        { type: 'ui-item' },
        encodeJournalUiItem(message(90)),
      );
      const tail = await writer.append(
        { type: 'ui-item' },
        encodeJournalUiItem(message(80)),
      );
      await update(() => {});
      const delta = await update(async () => {
        await writer.retract(tail);
        await writer.retract(head);
        await writer.append(
          { type: 'ui-item' },
          encodeJournalUiItem(message(2)),
        );
        await writer.append(
          { type: 'ui-item' },
          encodeJournalUiItem(message(1)),
        );
      });
      expect(count(delta.text, 'MSG_2_END')).toBe(1);
      expect(count(delta.text, 'MSG_1_END')).toBe(1);
      expect(delta.text.indexOf('MSG_2_END')).toBeLessThan(
        delta.text.indexOf('MSG_1_END'),
      );
      expect(delta.text).not.toContain('MSG_90_END');
      expect(delta.text).not.toContain('MSG_80_END');
      const refreshed = await update(async () => {
        await pager.invalidate();
        await pager.resumeFromJournal();
        turn.commands.refreshStatic();
      });
      expect(refreshed.text).not.toContain('MSG_90_END');
      expect(refreshed.text).not.toContain('MSG_80_END');
      expect(count(refreshed.text, 'MSG_2_END')).toBe(1);
      expect(count(refreshed.text, 'MSG_1_END')).toBe(1);
    });
  });
}

function registerScenario2(withLayout: Layout): void {
  it('keeps durable append order when source timestamps decrease and duplicate display IDs repeat', async () => {
    await withLayout(
      [],
      10,
      async ({ session, writer, update, durableRows }) => {
        const delta = await update(async () => {
          await session.append([
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'LATER_CLOCK3434' }],
              metadata: {
                chronology: { seq: 0, userTurn: 0, step: 0, recordedAt: 200 },
              },
            },
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'EARLIER_CLOCK3434' }],
              metadata: {
                chronology: { seq: 1, userTurn: 0, step: 0, recordedAt: 100 },
              },
            },
          ]);
          for (let index = 0; index < 2; index++)
            await writer.append(
              { type: 'ui-item' },
              encodeJournalUiItem(message(7)),
            );
        });
        expect(count(delta.text, 'LATER_CLOCK3434')).toBe(1);
        expect(count(delta.text, 'EARLIER_CLOCK3434')).toBe(1);
        expect(delta.text.indexOf('LATER_CLOCK3434')).toBeLessThan(
          delta.text.indexOf('EARLIER_CLOCK3434'),
        );
        expect(count(delta.text, 'MSG_7_END')).toBe(2);
        expect(new Set(delta.renderedKeys).size).toBe(4);
        expect(await durableRows()).toBe(4);
      },
    );
  });
}

function registerScenario3(withLayout: Layout): void {
  it('admits an oversized durable row and releases its resident bytes after emission', async () => {
    const limit = 4 * 1024 * 1024;
    const oversized = sizedMessage(1, limit + 1024, true);
    expect(serializedBytes([oversized])).toBeGreaterThan(limit);
    await withLayout(
      [oversized],
      1,
      async ({ initial, append, pager, durableRows }) => {
        expect(initial.renderedKeys).toHaveLength(1);
        expect(initial.bytes).toBeGreaterThan(limit);
        const delta = await append({
          type: 'gemini_content',
          text: 'AFTER_OVERSIZED3434',
        });
        expect(count(delta.text, 'AFTER_OVERSIZED3434')).toBe(1);
        expect(delta.renderedKeys).toHaveLength(1);
        expect(pager.metrics().residentBytes).toBeLessThanOrEqual(limit);
        expect(await durableRows()).toBe(2);
      },
      false,
      false,
      false,
    );
  }, 30000);
}

export function registerNativeCapScenarios(withLayout: Layout): void {
  registerScenario0(withLayout);
  registerScenario1(withLayout);
  registerScenario2(withLayout);
  registerScenario3(withLayout);
}
