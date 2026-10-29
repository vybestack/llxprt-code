/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import {
  withJournalResponse,
  sealText,
  renderedOrder,
} from './journal-response-test-helpers.js';

describe('journal continuation attempt boundaries (issue #3840)', () => {
  it('renders each continuation attempt as its own message, in order', async () => {
    await withJournalResponse(async (fixture) => {
      for (const id of ['attempt1', 'attempt2', 'attempt3']) {
        await sealText(fixture, id, [id]);
      }
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:attempt1',
        'text:attempt2',
        'text:attempt3',
      ]);
    });
  });

  it('renders later thinking after the earlier reply and keeps thinking-only attempts apart', async () => {
    await withJournalResponse(async (fixture) => {
      await sealText(fixture, 'first', ['READY']);
      for (const id of ['second', 'third']) {
        const arrival = await fixture.open(id);
        await arrival.append({ type: 'thinking', thought: `${id}: attempt` });
        await arrival.seal({});
      }
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:READY',
        'thinking:second: attempt',
        'thinking:third: attempt',
      ]);
    });
  });

  it('keeps a single attempt intact and ends it without a duplicate pending row', async () => {
    await withJournalResponse(async (fixture) => {
      const arrival = await fixture.open('only');
      await arrival.append({ type: 'thinking', thought: 'plan: look' });
      await arrival.append({ type: 'text', text: 'only ' });
      await arrival.append({ type: 'text', text: 'answer' });
      await arrival.seal({});
      const items = await fixture.items();
      expect(items).toHaveLength(1);
      expect(renderedOrder(items)).toStrictEqual([
        'thinking:plan: look',
        'text:only answer',
      ]);
    });
  });

  it('does not retract an earlier reply when a thinking-only later attempt is retried', async () => {
    await withJournalResponse(async (fixture) => {
      await sealText(fixture, 'first', ['first paragraph\n\nfirst tail']);
      const arrival = await fixture.open('second');
      await arrival.append({ type: 'thinking', thought: 'second: attempt' });
      await arrival.interrupt('superseded');
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:first paragraph\n\nfirst tail',
      ]);
    });
  });

  it('adds nothing for an empty attempt', async () => {
    await withJournalResponse(async (fixture) => {
      const empty = await fixture.open('empty');
      await empty.seal({});
      await sealText(fixture, 'next', ['attempt2']);
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:attempt2',
      ]);
    });
  });
});
