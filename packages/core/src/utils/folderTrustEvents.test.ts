/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CoreEventEmitter, CoreEvent } from './events.js';

describe('FolderTrustChanged event', () => {
  let events: CoreEventEmitter;

  beforeEach(() => {
    events = new CoreEventEmitter();
  });

  it('delivers trusted=true to subscribers when emitted', () => {
    const received: boolean[] = [];
    events.on(CoreEvent.FolderTrustChanged, (trusted: boolean) => {
      received.push(trusted);
    });

    events.emitFolderTrustChanged(true);

    expect(received).toStrictEqual([true]);
  });

  it('delivers trusted=false to subscribers when emitted', () => {
    const received: boolean[] = [];
    events.on(CoreEvent.FolderTrustChanged, (trusted: boolean) => {
      received.push(trusted);
    });

    events.emitFolderTrustChanged(false);

    expect(received).toStrictEqual([false]);
  });

  it('supports unsubscribe via off', () => {
    const received: boolean[] = [];
    const listener = (trusted: boolean) => {
      received.push(trusted);
    };
    events.on(CoreEvent.FolderTrustChanged, listener);
    events.off(CoreEvent.FolderTrustChanged, listener);

    events.emitFolderTrustChanged(true);

    expect(received).toStrictEqual([]);
  });

  it('does not throw when emitted without listeners', () => {
    expect(() => events.emitFolderTrustChanged(true)).not.toThrow();
  });

  it('broadcasts the same trust value to every subscriber', () => {
    const first: boolean[] = [];
    const second: boolean[] = [];
    events.on(CoreEvent.FolderTrustChanged, (trusted: boolean) =>
      first.push(trusted),
    );
    events.on(CoreEvent.FolderTrustChanged, (trusted: boolean) =>
      second.push(trusted),
    );

    events.emitFolderTrustChanged(false);

    expect(first).toStrictEqual([false]);
    expect(second).toStrictEqual([false]);
  });
});
