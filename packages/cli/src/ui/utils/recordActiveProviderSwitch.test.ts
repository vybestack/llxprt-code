/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { recordActiveProviderSwitch } from './recordActiveProviderSwitch.js';

describe('recordActiveProviderSwitch', () => {
  it('records the active provider and model from the runtime status', () => {
    const recorded: Array<[string, string]> = [];
    const failures: string[] = [];

    recordActiveProviderSwitch(
      {
        recordProviderSwitch: (provider, model) => {
          recorded.push([provider, model]);
        },
      },
      {
        getActiveProviderStatus: () => ({
          providerName: 'codex',
          modelName: 'gpt-6-luna',
          displayLabel: 'codex',
        }),
      },
      (message) => failures.push(message),
    );

    expect(recorded).toStrictEqual([['codex', 'gpt-6-luna']]);
    expect(failures).toStrictEqual([]);
  });

  it('reports a status read failure through reportFailure and records nothing', () => {
    const recorded: Array<[string, string]> = [];
    const failures: string[] = [];

    recordActiveProviderSwitch(
      {
        recordProviderSwitch: (provider, model) => {
          recorded.push([provider, model]);
        },
      },
      {
        getActiveProviderStatus: () => {
          throw new Error('provider status unavailable');
        },
      },
      (message) => failures.push(message),
    );

    expect(recorded).toStrictEqual([]);
    expect(failures).toStrictEqual([
      'Switched to provider/model, but recording the switch in the session file failed: provider status unavailable',
    ]);
  });

  it('does not read the runtime status when there is no recorder', () => {
    let statusReads = 0;

    recordActiveProviderSwitch(
      null,
      {
        getActiveProviderStatus: () => {
          statusReads += 1;
          return {
            providerName: 'codex',
            modelName: 'gpt-6-luna',
            displayLabel: 'codex',
          };
        },
      },
      () => {},
    );

    expect(statusReads).toBe(0);
  });
});
