/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { OAuthUIBridge, OAUTH_UI_MAX_PENDING } from '../oauth-ui-bridge.js';
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

function messageText(event: OAuthUIEvent): string {
  switch (event.type) {
    case 'info':
    case 'warning':
    case 'error':
    case 'oauth_url':
      return event.text;
    case 'oauth_waiting':
    case 'oauth_settled':
      return '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthUIBridge buffering', () => {
  let bridge: OAuthUIBridge;

  beforeEach(() => {
    bridge = new OAuthUIBridge();
  });

  it('installs no process-wide add-item hook', () => {
    expect(
      Object.getOwnPropertyNames(globalThis).filter((name) =>
        name.startsWith('__oauth'),
      ),
    ).toStrictEqual([]);
  });

  it('keeps separate instances isolated', () => {
    const other = new OAuthUIBridge();
    other.emit(makeOAuthEvent('other'), 1);
    other.beginDialog('other-attempt', 'claudecode');
    other.requestCode('claudecode');

    expect(bridge.getPendingCount()).toBe(0);
    expect(bridge.getDialog()).toBeUndefined();
    expect(bridge.getCodeRequest().needsCode).toBe(false);
  });

  // Test 1.1
  it('buffers events when no callback is attached', () => {
    const event = makeOAuthEvent('auth-url-1');

    const result = bridge.emit(event, 1000);

    expect(result).toBeUndefined();
    expect(bridge.getPendingCount()).toBe(1);
  });

  // Test 1.2
  it('flushes buffered events in FIFO order when callback attaches', () => {
    const received: Array<{ event: OAuthUIEvent; ts?: number }> = [];
    const callback = vi.fn(((event: OAuthUIEvent, ts?: number) => {
      received.push({ event, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    bridge.emit(makeOAuthEvent('first'), 100);
    bridge.emit(makeOAuthEvent('second'), 200);
    bridge.emit(makeOAuthEvent('third'), 300);

    expect(bridge.getPendingCount()).toBe(3);

    bridge.setCallback(callback);

    expect(callback).toHaveBeenCalledTimes(3);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
    expect(received[2]?.ts).toBe(300);
    expect(bridge.getPendingCount()).toBe(0);
  });

  // Test 1.3
  it('delivers events directly to callback when one is attached', () => {
    const callback = vi.fn(
      ((_event: OAuthUIEvent, _ts?: number) => 42) satisfies OAuthUICallback,
    );
    bridge.setCallback(callback);

    const result = bridge.emit(makeOAuthEvent('direct'), 500);

    expect(result).toBe(42);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(bridge.getPendingCount()).toBe(0);
  });

  // Test 1.4
  it('clearCallback does NOT clear the buffer', () => {
    bridge.emit(makeOAuthEvent('item-a'), 100);
    bridge.emit(makeOAuthEvent('item-b'), 200);

    expect(bridge.getPendingCount()).toBe(2);

    bridge.clearCallback();

    expect(bridge.getPendingCount()).toBe(2);

    const received: Array<{ event: OAuthUIEvent; ts?: number }> = [];
    bridge.setCallback(((event: OAuthUIEvent, ts?: number) => {
      received.push({ event, ts });
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(2);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
  });

  // Test 1.5
  it('clearPending empties the buffer', () => {
    bridge.emit(makeOAuthEvent('a'));
    bridge.emit(makeOAuthEvent('b'));
    bridge.emit(makeOAuthEvent('c'));

    expect(bridge.getPendingCount()).toBe(3);

    bridge.clearPending();

    expect(bridge.getPendingCount()).toBe(0);
  });

  // Test 1.7
  it('delivers multiple rapid events in exact buffer order', () => {
    for (let i = 0; i < 10; i++) {
      bridge.emit(makeOAuthEvent(`event-${i}`), i);
    }

    expect(bridge.getPendingCount()).toBe(10);

    const received: number[] = [];
    bridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      received.push(ts ?? -1);
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // Test 1.8
  it('caps buffer at OAUTH_UI_MAX_PENDING with drop-oldest', () => {
    const totalEvents = OAUTH_UI_MAX_PENDING + 5;
    for (let i = 1; i <= totalEvents; i++) {
      bridge.emit(makeOAuthEvent(`event-${i}`), i);
    }

    expect(bridge.getPendingCount()).toBe(OAUTH_UI_MAX_PENDING);

    const received: number[] = [];
    bridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
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
    bridge.emit(makeInfoEvent('event-1'), 100);
    bridge.emit(makeInfoEvent('event-2'), 200);
    bridge.emit(makeInfoEvent('event-3'), 300);

    const delivered: number[] = [];
    let callCount = 0;
    bridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('callback error on event 2');
      }
      delivered.push(ts ?? -1);
      return callCount;
    }) satisfies OAuthUICallback);

    // Events 1 and 3 were delivered; event 2 threw
    expect(delivered).toStrictEqual([100, 300]);
    expect(bridge.getPendingCount()).toBe(0);
  });

  // Test 1.10
  it('reentrant emit during flush goes directly to callback', () => {
    bridge.emit(makeInfoEvent('buffered-1'), 100);
    bridge.emit(makeInfoEvent('buffered-2'), 200);

    const deliveryOrder: string[] = [];
    let callCount = 0;
    bridge.setCallback(((event: OAuthUIEvent, _ts?: number) => {
      callCount++;
      const text = messageText(event);
      deliveryOrder.push(text);

      // During flush of buffered-1, emit a reentrant event
      if (text === 'buffered-1') {
        bridge.emit(makeInfoEvent('reentrant'), 150);
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

  // Test 1.12 — warning variant buffers and flushes like other variants
  it('buffers and flushes warning events in FIFO order with other variants', () => {
    bridge.emit(makeInfoEvent('info-1'), 10);
    bridge.emit(makeWarningEvent('warn-1'), 20);
    bridge.emit(makeWarningEvent('warn-2'), 30);

    expect(bridge.getPendingCount()).toBe(3);

    const received: Array<{ text: string; ts?: number }> = [];
    bridge.setCallback(((event: OAuthUIEvent, ts?: number) => {
      received.push({ text: messageText(event), ts });
      return received.length;
    }) satisfies OAuthUICallback);

    expect(received).toHaveLength(3);
    expect(received[0]?.text).toBe('info-1');
    expect(received[0]?.ts).toBe(10);
    expect(received[1]?.text).toBe('warn-1');
    expect(received[1]?.ts).toBe(20);
    expect(received[2]?.text).toBe('warn-2');
    expect(received[2]?.ts).toBe(30);
    expect(bridge.getPendingCount()).toBe(0);
  });

  // Test 1.13 — warning variant is subject to the same cap as other variants
  it('warning events are dropped oldest when the buffer cap is exceeded', () => {
    const total = OAUTH_UI_MAX_PENDING + 2;
    for (let i = 1; i <= total; i++) {
      bridge.emit(makeWarningEvent(`warn-${i}`), i);
    }

    expect(bridge.getPendingCount()).toBe(OAUTH_UI_MAX_PENDING);

    const received: number[] = [];
    bridge.setCallback(((_event: OAuthUIEvent, ts?: number) => {
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
