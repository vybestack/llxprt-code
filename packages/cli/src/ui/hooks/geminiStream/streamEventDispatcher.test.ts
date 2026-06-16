/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { FinishReason } from '@google/genai';
import type React from 'react';
import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import type { StreamEventDeps } from './streamEventDispatcher.js';
import { dispatchStreamEvent } from './streamEventDispatcher.js';
import type { HistoryItemWithoutId } from '../../types.js';

type GeminiEvent = ServerGeminiStreamEvent;

function createDeps(overrides: Partial<StreamEventDeps> = {}): StreamEventDeps {
  return {
    config: { getModel: () => 'test-model' } as never,
    addItem: vi.fn(),
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: { current: [] } as React.MutableRefObject<
      Array<import('@vybestack/llxprt-code-core').ThinkingBlock>
    >,
    turnCancelledRef: { current: false } as React.MutableRefObject<boolean>,
    loopDetectedRef: { current: false } as React.MutableRefObject<boolean>,
    lastModelInfoRef: { current: null } as React.MutableRefObject<
      string | null
    >,
    lastModelIdentityRef: { current: null } as React.MutableRefObject<
      string | null
    >,
    setPendingHistoryItem: vi.fn(),
    setLastGeminiActivityTime: vi.fn(),
    setThought: vi.fn(),
    handleContentEvent: vi.fn((_value, buffer) => buffer),
    handleUserCancelledEvent: vi.fn(),
    handleErrorEvent: vi.fn(),
    handleChatCompressionEvent: vi.fn(),
    handleFinishedEvent: vi.fn(),
    handleMaxSessionTurnsEvent: vi.fn(),
    handleContextWindowWillOverflowEvent: vi.fn(),
    handleCitationEvent: vi.fn(),
    scheduleToolCalls: vi.fn(),
    ...overrides,
  };
}

function createModelInfoEvent(
  model: string,
  extras: {
    providerName?: string;
    profileName?: string | null;
    displayLabel?: string;
  } = {},
): GeminiEvent {
  return {
    type: GeminiEventType.ModelInfo,
    value: {
      model,
      providerName: extras.providerName,
      profileName: extras.profileName,
      displayLabel: extras.displayLabel ?? model,
    },
  } as GeminiEvent;
}

describe('dispatchStreamEvent - ModelInfo inline notification', () => {
  it('adds a profile_change history item when model differs from previous sequence', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'old-profile' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'old-profile', 'old-model']) as
        | string
        | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'production',
      displayLabel: 'production',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    const [item, timestamp] = addItem.mock.calls[0];
    expect(item.type).toBe('profile_change');
    expect(item.profileName).toBe('production');
    expect(timestamp).toBe(1000);
  });

  it('does not add notification when model/profile same as previous sequence', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'production' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'production', 'gpt-4o']) as
        | string
        | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'production',
      displayLabel: 'production',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).not.toHaveBeenCalled();
  });

  it('updates lastModelInfoRef after first emission', () => {
    const lastModelInfoRef = { current: 'old-label' as string | null };
    const deps = createDeps({ lastModelInfoRef });

    const event = createModelInfoEvent('claude-sonnet', {
      profileName: 'work',
      displayLabel: 'work',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(lastModelInfoRef.current).toBe('work');
  });

  it('adds a Responding-with notification on first assistant response so users always see model context', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: null as string | null };
    const lastModelIdentityRef = { current: null as string | null };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('llama3', {
      profileName: null,
      displayLabel: 'llama3',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    // Baseline: first response always shows a notification so the user sees
    // which model/profile is handling their prompt.
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].type).toBe('profile_change');
    expect(addItem.mock.calls[0][0].profileName).toBe('llama3');
    expect(lastModelInfoRef.current).toBe('llama3');
  });

  it('adds a Responding-with notification on first response with profile name when available', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: null as string | null };
    const lastModelIdentityRef = { current: null as string | null };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'work',
      displayLabel: 'work',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('work');
  });

  it('does not add a duplicate notification on second response with same identity', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: null as string | null };
    const lastModelIdentityRef = { current: null as string | null };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'work',
      displayLabel: 'work',
    });

    // First response: notification shown
    dispatchStreamEvent(event, deps, '', 1000);
    expect(addItem).toHaveBeenCalledTimes(1);

    // Second response, same identity: no duplicate
    dispatchStreamEvent(event, deps, '', 2000);
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('uses displayLabel for the profile_change item name', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'old-profile' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'old-profile', 'old-model']) as
        | string
        | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      profileName: 'my-profile',
      displayLabel: 'My Custom Label',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('My Custom Label');
  });

  it('handles events without profileName by using displayLabel', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'old-model' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['ollama', '', 'old-model']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('new-model', {
      profileName: null,
      displayLabel: 'new-model',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('new-model');
  });

  it('produces notification when displayLabel is same but provider differs', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'My Label' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'work', 'gpt-4o']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    // Same displayLabel 'My Label' but different provider
    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'azure',
      profileName: 'work',
      displayLabel: 'My Label',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('My Label');
  });

  it('produces notification when displayLabel is same but model differs', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'work' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'work', 'gpt-4o']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    // Same displayLabel 'work' but different model
    const event = createModelInfoEvent('gpt-4o-mini', {
      providerName: 'openai',
      profileName: 'work',
      displayLabel: 'work',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('work');
  });

  it('produces notification when displayLabel is same but profile differs', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'gpt-4o' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'work', 'gpt-4o']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    // Same displayLabel (falls back to model 'gpt-4o') but different profile
    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'personal',
      displayLabel: 'gpt-4o',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].profileName).toBe('gpt-4o');
  });

  it('does not produce notification when full identity matches even if displayLabel computed identically', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'work' as string | null };
    const lastModelIdentityRef = {
      current: JSON.stringify(['openai', 'work', 'gpt-4o']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    const event = createModelInfoEvent('gpt-4o', {
      providerName: 'openai',
      profileName: 'work',
      displayLabel: 'work',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    expect(addItem).not.toHaveBeenCalled();
  });

  it('uses collision-safe identity: values containing pipe characters do not collide', () => {
    const addItem = vi.fn();
    const lastModelInfoRef = { current: 'model-label' as string | null };
    // Previous identity: provider 'a|b', profile '', model 'model'
    const lastModelIdentityRef = {
      current: JSON.stringify(['a|b', '', 'model']) as string | null,
    };
    const deps = createDeps({
      addItem,
      lastModelInfoRef,
      lastModelIdentityRef,
    });

    // New event: provider 'a', profile 'b', model 'model'
    // With a naive pipe-join, both would produce 'a|b||model' and incorrectly
    // suppress the notification. JSON.stringify avoids this collision.
    const event = createModelInfoEvent('model', {
      providerName: 'a',
      profileName: 'b',
      displayLabel: 'model-label',
    });

    dispatchStreamEvent(event, deps, '', 1000);

    // Identity is different: ['a','b','model'] !== ['a|b','','model']
    expect(addItem).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchStreamEvent - stream buffer lifecycle', () => {
  it.each([
    GeminiEventType.Finished,
    GeminiEventType.Error,
    GeminiEventType.StreamIdleTimeout,
    GeminiEventType.UserCancelled,
    GeminiEventType.LoopDetected,
    GeminiEventType.MaxSessionTurns,
    GeminiEventType.ContextWindowWillOverflow,
    GeminiEventType.AgentExecutionStopped,
    GeminiEventType.AgentExecutionBlocked,
  ])('clears accumulated content buffer after %s', (eventType) => {
    const deps = createDeps();
    const event = createTerminalEvent(eventType);

    const result = dispatchStreamEvent(
      event,
      deps,
      'stale assistant text',
      1000,
    );

    expect(result.geminiMessageBuffer).toBe('');
  });

  it('does not prepend content from a finished turn to the next turn', () => {
    const handleContentEvent = vi.fn(
      (value: string, buffer: string) => buffer + value,
    );
    const deps = createDeps({ handleContentEvent });

    const first = dispatchStreamEvent(
      { type: GeminiEventType.Content, value: 'first' },
      deps,
      '',
      1000,
    );
    const finished = dispatchStreamEvent(
      { type: GeminiEventType.Finished, value: { reason: FinishReason.STOP } },
      deps,
      first.geminiMessageBuffer,
      1000,
    );
    const next = dispatchStreamEvent(
      { type: GeminiEventType.Content, value: 'second' },
      deps,
      finished.geminiMessageBuffer,
      1001,
    );

    expect(next.geminiMessageBuffer).toBe('second');
  });

  it('flushes pending Gemini content before clearing buffer on Finished', () => {
    const pendingHistoryItemRef = {
      current: { type: 'gemini', text: 'first' },
    } as React.MutableRefObject<HistoryItemWithoutId | null>;
    const flushPendingHistoryItem = vi.fn();
    const setPendingHistoryItem = vi.fn((value) => {
      if (value === null) {
        pendingHistoryItemRef.current = null;
      }
    });
    const deps = createDeps({
      pendingHistoryItemRef,
      flushPendingHistoryItem,
      setPendingHistoryItem,
    });

    const result = dispatchStreamEvent(
      { type: GeminiEventType.Finished, value: { reason: FinishReason.STOP } },
      deps,
      'first',
      1000,
    );

    expect(result.geminiMessageBuffer).toBe('');
    expect(flushPendingHistoryItem).toHaveBeenCalledWith(1000);
    expect(pendingHistoryItemRef.current).toBeNull();
  });
});

function createTerminalEvent(eventType: GeminiEventType): GeminiEvent {
  switch (eventType) {
    case GeminiEventType.Finished:
      return {
        type: eventType,
        value: { reason: FinishReason.STOP },
      } as GeminiEvent;
    case GeminiEventType.Error:
      return {
        type: eventType,
        value: { error: { message: 'failed' } },
      } as GeminiEvent;
    case GeminiEventType.StreamIdleTimeout:
      return {
        type: eventType,
        value: { error: { message: 'idle' } },
      } as GeminiEvent;
    case GeminiEventType.ContextWindowWillOverflow:
      return {
        type: eventType,
        value: { estimatedRequestTokenCount: 100, remainingTokenCount: 1 },
      } as GeminiEvent;
    case GeminiEventType.AgentExecutionStopped:
    case GeminiEventType.AgentExecutionBlocked:
      return {
        type: eventType,
        reason: 'hook',
        systemMessage: 'hook',
      } as GeminiEvent;
    default:
      return { type: eventType } as GeminiEvent;
  }
}
