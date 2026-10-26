/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { FanoutHarness } from './__tests__/support/fanout-harness.js';
import type { IContent, ContentMetadata } from './IContent.js';

const harness = new FanoutHarness();
const metadata: ContentMetadata = {
  id: 'response',
  chronology: { seq: 1, userTurn: 0, step: 1, recordedAt: 0 },
};
describe('response arrival publication effects', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());
  it('matches ordinary exported bytes, observers, counts and token publication', async () => {
    const arrivalHistory = harness.history();
    const ordinary = harness.history();
    const observed: IContent[] = [];
    arrivalHistory.on('contentAdded', (content) => {
      observed.push(content);
    });
    const arrival = await arrivalHistory.openResponseArrival(
      { id: 'one', submissionId: 'prompt' },
      structuredClone(metadata),
    );
    await arrival.append({ type: 'text', text: 'quote " and ' });
    await arrival.append({ type: 'text', text: 'unicode 🌙' });
    await arrival.seal({});
    ordinary.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'quote " and unicode 🌙' }],
      metadata: structuredClone(metadata),
    });
    await arrivalHistory.waitForTokenUpdates();
    await ordinary.waitForTokenUpdates();
    expect((await Array.fromAsync(arrivalHistory.streamJSON())).join('')).toBe(
      (await Array.fromAsync(ordinary.streamJSON())).join(''),
    );
    expect(observed).toHaveLength(1);
    expect(observed[0].blocks).toStrictEqual(
      (await harness.shared(ordinary))[0].blocks,
    );
    expect(arrivalHistory.getTotalTokens()).toBe(ordinary.getTotalTokens());
    expect(arrivalHistory.length()).toBe(1);
  });
  it('fans sealed rows out only to the selected origin', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    const arrival = await service.openResponseArrival(
      { id: 'owned', submissionId: 'prompt' },
      {},
      ownerB,
    );
    await arrival.append({ type: 'text', text: 'owned response' });
    await arrival.seal({});
    service.add(
      { speaker: 'ai', blocks: [{ type: 'text', text: 'ordinary response' }] },
      undefined,
      ownerA,
    );
    await service.waitForCommit();
    expect(await harness.replayed(a)).toStrictEqual([
      'seed',
      'ordinary response',
    ]);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'owned response']);
    expect(service.length()).toBe(3);
  });
  it('interrupts without a context row and retains the prompt', async () => {
    const service = harness.history();
    await service.submitPrompt('prompt', [
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
    ]);
    const arrival = await service.openResponseArrival({
      id: 'cancel',
      submissionId: 'prompt',
    });
    await arrival.append({ type: 'text', text: 'unfinished' });
    await arrival.interrupt('cancelled');
    expect(service.length()).toBe(1);
    expect(await service.hasPromptSubmission('prompt')).toBe(true);
    expect((await harness.shared(service))[0].speaker).toBe('human');
  });
  it('compensates a sealed row when an observer rejects publication', async () => {
    const service = harness.history();
    service.on('contentAdded', () => {
      throw new Error('observer rejected');
    });
    const arrival = await service.openResponseArrival({
      id: 'rejected',
      submissionId: 'prompt',
    });
    await arrival.append({ type: 'text', text: 'rejected' });
    await expect(arrival.seal({})).rejects.toThrow('observer rejected');
    await service.waitForCommit();
    expect(service.length()).toBe(0);
    expect(service.getTotalTokens()).toBe(0);
  });
});
