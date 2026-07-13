/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useQueuedSubmissions } from '../useQueuedSubmissions.js';
import type { QueuedSubmission } from '../types.js';

function makeSubmission(text: string): QueuedSubmission {
  return { query: [{ type: 'text', text }] };
}

function firstText(sub: QueuedSubmission | undefined): string | undefined {
  const first = Array.isArray(sub?.query) ? sub.query[0] : undefined;
  return isTextBlock(first) ? first.text : undefined;
}

function isTextBlock(part: unknown): part is { type: 'text'; text: string } {
  if (typeof part !== 'object' || part === null) {
    return false;
  }
  if (!('type' in part) || part.type !== 'text') {
    return false;
  }
  return 'text' in part && typeof part.text === 'string';
}

describe('useQueuedSubmissions', () => {
  describe('initial state', () => {
    it('starts with an empty queue', () => {
      const { result } = renderHook(() => useQueuedSubmissions());
      expect(result.current.queuedSubmissions).toStrictEqual([]);
    });

    it('starts with an empty ref', () => {
      const { result } = renderHook(() => useQueuedSubmissions());
      expect(result.current.queuedSubmissionsRef.current).toStrictEqual([]);
    });
  });

  describe('enqueueSubmission', () => {
    it('adds a submission to the end of the queue', () => {
      const { result } = renderHook(() => useQueuedSubmissions());
      const sub = makeSubmission('hello');

      act(() => {
        result.current.enqueueSubmission(sub);
      });

      expect(result.current.queuedSubmissions).toHaveLength(1);
      expect(result.current.queuedSubmissions[0]).toStrictEqual(sub);
    });

    it('appends in FIFO order when enqueuing multiple submissions', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('first'));
        result.current.enqueueSubmission(makeSubmission('second'));
        result.current.enqueueSubmission(makeSubmission('third'));
      });

      const texts = result.current.queuedSubmissions.map(firstText);
      expect(texts).toStrictEqual(['first', 'second', 'third']);
    });

    it('synchronously updates the ref so callbacks see the new value', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('sync'));
      });

      expect(result.current.queuedSubmissionsRef.current).toHaveLength(1);
    });

    it('does not mutate the previous queue array (immutable)', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('a'));
      });
      const firstSnapshot = result.current.queuedSubmissions;

      act(() => {
        result.current.enqueueSubmission(makeSubmission('b'));
      });

      expect(firstSnapshot).toHaveLength(1);
      expect(result.current.queuedSubmissions).toHaveLength(2);
    });
  });

  describe('dequeueSubmission', () => {
    it('returns undefined when the queue is empty', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      let dequeued: QueuedSubmission | undefined;
      act(() => {
        dequeued = result.current.dequeueSubmission();
      });

      expect(dequeued).toBeUndefined();
    });

    it('removes and returns the first submission (FIFO)', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('first'));
        result.current.enqueueSubmission(makeSubmission('second'));
      });

      let first: QueuedSubmission | undefined;
      act(() => {
        first = result.current.dequeueSubmission();
      });

      expect(firstText(first)).toBe('first');
      expect(result.current.queuedSubmissions).toHaveLength(1);
      expect(firstText(result.current.queuedSubmissions[0])).toBe('second');
    });

    it('synchronously updates the ref so the dequeued item is gone immediately', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('x'));
      });

      act(() => {
        result.current.dequeueSubmission();
      });

      expect(result.current.queuedSubmissionsRef.current).toHaveLength(0);
    });

    it('drains to empty in FIFO order', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('a'));
        result.current.enqueueSubmission(makeSubmission('b'));
        result.current.enqueueSubmission(makeSubmission('c'));
      });

      const order: string[] = [];
      act(() => {
        let item = result.current.dequeueSubmission();
        while (item) {
          const text = firstText(item);
          if (text !== undefined) {
            order.push(text);
          }
          item = result.current.dequeueSubmission();
        }
      });

      expect(order).toStrictEqual(['a', 'b', 'c']);
      expect(result.current.queuedSubmissions).toHaveLength(0);
    });
  });

  describe('requeueSubmission', () => {
    it('restores a failed drain to the front without changing FIFO order', () => {
      const { result } = renderHook(() => useQueuedSubmissions());
      const first = makeSubmission('first');

      act(() => {
        result.current.enqueueSubmission(first);
        result.current.enqueueSubmission(makeSubmission('second'));
        result.current.dequeueSubmission();
        result.current.requeueSubmission(first);
      });

      expect(result.current.queuedSubmissions.map(firstText)).toStrictEqual([
        'first',
        'second',
      ]);
      expect(
        result.current.queuedSubmissionsRef.current.map(firstText),
      ).toStrictEqual(['first', 'second']);
    });
  });

  describe('drain reservation', () => {
    it('allows only one reservation until the owner releases it', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      expect(result.current.tryReserveDrain()).toBe(true);
      expect(result.current.tryReserveDrain()).toBe(false);
    });

    it('allows another reservation after release', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      expect(result.current.tryReserveDrain()).toBe(true);
      result.current.releaseDrain();

      expect(result.current.tryReserveDrain()).toBe(true);
    });

    it('keeps reservations isolated between hook instances', () => {
      const { result: first } = renderHook(() => useQueuedSubmissions());
      const { result: second } = renderHook(() => useQueuedSubmissions());

      expect(first.current.tryReserveDrain()).toBe(true);
      expect(second.current.tryReserveDrain()).toBe(true);
    });
  });

  describe('clearSubmissions', () => {
    it('removes all submissions from the queue', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('a'));
        result.current.enqueueSubmission(makeSubmission('b'));
      });

      act(() => {
        result.current.clearSubmissions();
      });

      expect(result.current.queuedSubmissions).toHaveLength(0);
      expect(result.current.queuedSubmissionsRef.current).toHaveLength(0);
    });
  });

  describe('ref and state synchronization', () => {
    it('ref and state are always consistent after a sequence of operations', () => {
      const { result } = renderHook(() => useQueuedSubmissions());

      act(() => {
        result.current.enqueueSubmission(makeSubmission('1'));
        result.current.enqueueSubmission(makeSubmission('2'));
        result.current.dequeueSubmission();
        result.current.enqueueSubmission(makeSubmission('3'));
      });

      expect(result.current.queuedSubmissions).toStrictEqual(
        result.current.queuedSubmissionsRef.current,
      );
      expect(result.current.queuedSubmissions).toHaveLength(2);
    });
  });
});
