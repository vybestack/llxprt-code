/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createTerminalHost } from './terminalHost.js';
import type { InteractiveInstanceCapability } from './interactiveUiLifecycle.js';

describe('terminal host ownership', () => {
  it('replaces and cleans only the resources owned by that terminal host', async () => {
    const events: string[] = [];
    function instance(name: string): InteractiveInstanceCapability {
      return {
        clear: () => {
          events.push(`${name}:clear`);
        },
        unmount: () => {
          events.push(`${name}:unmount`);
        },
      };
    }
    const first = createTerminalHost();
    const second = createTerminalHost();
    first.publish(instance('first'), {
      dispose: async () => {
        events.push('first:dispose');
      },
    });
    second.publish(instance('second'), {
      dispose: async () => {
        events.push('second:dispose');
      },
    });
    await first.cleanup();
    await first.cleanup();
    expect(events).toStrictEqual([
      'first:clear',
      'first:unmount',
      'first:dispose',
    ]);
    await second.cleanup();
    expect(events).toStrictEqual([
      'first:clear',
      'first:unmount',
      'first:dispose',
      'second:clear',
      'second:unmount',
      'second:dispose',
    ]);
  });
});
