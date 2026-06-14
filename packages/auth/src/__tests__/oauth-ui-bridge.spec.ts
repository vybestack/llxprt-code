/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { oauthUIBridge, OAUTH_UI_MAX_PENDING } from '../oauth-ui-bridge.js';
import type { OAuthUIEvent, OAuthUICallback } from '../oauth-ui-events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOAuthEvent(text: string): OAuthUIEvent {
  return {
    type: 'oauth_url',
    text,
    url: `https://example.com/${text}`,
  };
}

function makeInfoEvent(text: string): OAuthUIEvent {
  return { type: 'info', text };
}

function makeWarningEvent(text: string): OAuthUIEvent {
  return { type: 'warning', text };
}

// ---------------------------------------------------------------------------
// Helpers for discriminated-union narrowing (kept outside test bodies so the
// vitest no-conditional-in-test / no-conditional-expect rules are satisfied).
// ---------------------------------------------------------------------------

function infoExtras(event: OAuthUIEvent): { icon?: string; color?: string } {
  switch (event.type) {
    case 'info':
      return { icon: event.icon, color: event.color };
    default:
      return { icon: undefined, color: undefined };
  }
}

function errorText(event: OAuthUIEvent): string {
  return event.type === 'error' ? event.text : '';
}

function oauthUrl(event: OAuthUIEvent): string {
  return event.type === 'oauth_url' ? event.url : '';
}

function warningText(event: OAuthUIEvent): string {
  return event.type === 'warning' ? event.text : '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthUIBridge buffering', () => {
  beforeEach(() => {
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
  });

  // Test 1.1
  it('buffers events when no callback is attached', () => {
    const event = makeOAuthEvent('auth-url-1');

    const result = oauthUIBridge.emit(event, 1000);

    expect(result).toBeUndefined();
    expect(oauthUIBridge.getPendingCount()).toBe(1);
  });

  // Test 1.2
  it('flushes buffered events in FIFO order when callback attaches', () => {
    const received: Array<{ event: OAuthUIEvent; ts?: number }> = [];
    const callback = vi.fn(((event: OAuthUIEvent, ts?: number) => {
      received.push({ event, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    oauthUIBridge.emit(makeOAuthEvent('first'), 100);
    oauthUIBridge.emit(makeOAuthEvent('second'), 200);
    oauthUIBridge.emit(makeOAuthEvent('third'), 300);

    expect(oauthUIBridge.getPendingCount()).toBe(3);

    oauthUIBridge.setCallback(callback);

    expect(callback).toHaveBeenCalledTimes(3);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
    expect(received[2]?.ts).toBe(300);
    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.3
  it('delivers events directly to callback when one is attached', () => {
    const callback = vi.fn(
      ((_event: OAuthUIEvent, _ts?: number) => 42) satisfies OAuthUICallback,
    );
    oauthUIBridge.setCallback(callback);

    const result = oauthUIBridge.emit(makeOAuthEvent('direct'), 500);

    expect(result).toBe(42);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.4
  it('clearCallback does NOT clear the buffer', () => {
    oauthUIBridge.emit(makeOAuthEvent('item-a'), 100);
    oauthUIBridge.emit(makeOAuthEvent('item-b'), 200);

    expect(oauthUIBridge.getPendingCount()).toBe(2);

    oauthUIBridge.clearCallback();

    expect(oauthUIBridge.getPendingCount()).toBe(2);

    const received: Array<{ event: OAuthUIEvent; ts?: number }> = [];
    oauthUIBridge.setCallback(((event: OAuthUIEvent, ts?: number) => {
      received.push({ event, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(2);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
  });

  // Test 1.5
  it('clearPending empties the buffer', () => {
    oauthUIBridge.emit(makeOAuthEvent('a'));
    oauthUIBridge.emit(makeOAuthEvent('b'));
    oauthUIBridge.emit(makeOAuthEvent('c'));

    expect(oauthUIBridge.getPendingCount()).toBe(3);

    oauthUIBridge.clearPending();

    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.6
  it('global __oauth_add_item hook is registered at module load and buffers', () => {
    const bridge = (global as Record<string, unknown>).__oauth_add_item as
      | ((event: OAuthUIEvent, ts?: number) => number | undefined)
      | undefined;

    expect(typeof bridge).toBe('function');

    bridge?.(makeOAuthEvent('via-bridge'), 999);

    expect(oauthUIBridge.getPendingCount()).toBe(1);

    const received: Array<{ event: OAuthUIEvent; ts?: number }> = [];
    oauthUIBridge.setCallback(((event: OAuthUIEvent, ts?: number) => {
      received.push({ event, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(1);
    expect(received[0]?.ts).toBe(999);
  });

  // Test 1.7
  it('delivers multiple rapid events in exact buffer order', () => {
    for (let i = 0; i < 10; i++) {
      oauthUIBridge.emit(makeOAuthEvent(`event-${i}`), i);
    }

    expect(oauthUIBridge.getPendingCount()).toBe(10);

    const received: number[] = [];
    oauthUIBridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      received.push(ts ?? -1);
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // Test 1.8
  it('caps buffer at OAUTH_UI_MAX_PENDING with drop-oldest', () => {
    const totalEvents = OAUTH_UI_MAX_PENDING + 5;
    for (let i = 1; i <= totalEvents; i++) {
      oauthUIBridge.emit(makeOAuthEvent(`event-${i}`), i);
    }

    expect(oauthUIBridge.getPendingCount()).toBe(OAUTH_UI_MAX_PENDING);

    const received: number[] = [];
    oauthUIBridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      received.push(ts ?? -1);
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(OAUTH_UI_MAX_PENDING);
    // Events 1-5 were dropped (oldest); first event is 6
    expect(received[0]).toBe(6);
    expect(received[received.length - 1]).toBe(totalEvents);
  });

  // Test 1.9
  it('callback throwing during flush does not block other events', () => {
    oauthUIBridge.emit(makeInfoEvent('event-1'), 100);
    oauthUIBridge.emit(makeInfoEvent('event-2'), 200);
    oauthUIBridge.emit(makeInfoEvent('event-3'), 300);

    const delivered: number[] = [];
    let callCount = 0;
    oauthUIBridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('callback error on event 2');
      }
      delivered.push(ts ?? -1);
      return callCount;
    }) satisfies OAuthUICallback);

    // Events 1 and 3 were delivered; event 2 threw
    expect(delivered).toStrictEqual([100, 300]);
    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.10
  it('reentrant emit during flush goes directly to callback', () => {
    oauthUIBridge.emit(makeInfoEvent('buffered-1'), 100);
    oauthUIBridge.emit(makeInfoEvent('buffered-2'), 200);

    const deliveryOrder: string[] = [];
    let callCount = 0;
    oauthUIBridge.setCallback(((event: OAuthUIEvent, _ts?: number) => {
      callCount++;
      const text = event.text;
      deliveryOrder.push(text);

      // During flush of buffered-1, emit a reentrant event
      if (text === 'buffered-1') {
        oauthUIBridge.emit(makeInfoEvent('reentrant'), 150);
      }
      return callCount;
    }) satisfies OAuthUICallback);

    // Reentrant event is interleaved: buffered-1, reentrant, buffered-2
    expect(deliveryOrder).toStrictEqual([
      'buffered-1',
      'reentrant',
      'buffered-2',
    ]);
  });

  // Test 1.11
  it('global __oauth_add_item hook routes through the bridge singleton', () => {
    const bridge = (global as Record<string, unknown>).__oauth_add_item as
      | ((event: OAuthUIEvent, ts?: number) => number | undefined)
      | undefined;

    expect(typeof bridge).toBe('function');

    const callback = vi.fn(
      ((_event: OAuthUIEvent, _ts?: number) => 7) satisfies OAuthUICallback,
    );
    oauthUIBridge.setCallback(callback);

    const result = bridge?.(makeOAuthEvent('hook-direct'), 1234);

    expect(result).toBe(7);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.12 — warning variant buffers and flushes like other variants
  it('buffers and flushes warning events in FIFO order with other variants', () => {
    oauthUIBridge.emit(makeInfoEvent('info-1'), 10);
    oauthUIBridge.emit(makeWarningEvent('warn-1'), 20);
    oauthUIBridge.emit(makeWarningEvent('warn-2'), 30);

    expect(oauthUIBridge.getPendingCount()).toBe(3);

    const received: Array<{ text: string; ts?: number }> = [];
    oauthUIBridge.setCallback(((event: OAuthUIEvent, ts?: number) => {
      received.push({ text: event.text, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(3);
    expect(received[0]?.text).toBe('info-1');
    expect(received[0]?.ts).toBe(10);
    expect(received[1]?.text).toBe('warn-1');
    expect(received[1]?.ts).toBe(20);
    expect(received[2]?.text).toBe('warn-2');
    expect(received[2]?.ts).toBe(30);
    expect(oauthUIBridge.getPendingCount()).toBe(0);
  });

  // Test 1.13 — warning variant is subject to the same cap as other variants
  it('warning events are dropped oldest when the buffer cap is exceeded', () => {
    const total = OAUTH_UI_MAX_PENDING + 2;
    for (let i = 1; i <= total; i++) {
      oauthUIBridge.emit(makeWarningEvent(`warn-${i}`), i);
    }

    expect(oauthUIBridge.getPendingCount()).toBe(OAUTH_UI_MAX_PENDING);

    const received: number[] = [];
    oauthUIBridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      received.push(ts ?? -1);
      return received.length;
    }) satisfies OAuthUICallback);

    // Events 1-2 were dropped (oldest); first retained event is 3
    expect(received).toHaveLength(OAUTH_UI_MAX_PENDING);
    expect(received[0]).toBe(3);
    expect(received[received.length - 1]).toBe(total);
  });
});

describe('OAuthUIEvent discriminated union', () => {
  it('info event carries optional icon and color', () => {
    const event: OAuthUIEvent = {
      type: 'info',
      text: 'hello',
      icon: 'ℹ ',
      color: 'yellow',
    };
    expect(event.type).toBe('info');
    const extras = infoExtras(event);
    expect(extras.icon).toBe('ℹ ');
    expect(extras.color).toBe('yellow');
  });

  it('error event carries only text', () => {
    const event: OAuthUIEvent = { type: 'error', text: 'boom' };
    expect(event.type).toBe('error');
    expect(errorText(event)).toBe('boom');
  });

  it('oauth_url event carries text and url', () => {
    const event: OAuthUIEvent = {
      type: 'oauth_url',
      text: 'visit me',
      url: 'https://example.com/auth',
    };
    expect(event.type).toBe('oauth_url');
    expect(oauthUrl(event)).toBe('https://example.com/auth');
  });

  it('warning event carries only text', () => {
    const event: OAuthUIEvent = { type: 'warning', text: 'heads up' };
    expect(event.type).toBe('warning');
    expect(warningText(event)).toBe('heads up');
  });
});
