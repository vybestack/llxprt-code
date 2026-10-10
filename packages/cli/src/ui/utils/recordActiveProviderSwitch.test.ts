/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  dialogProviderSwitchRecorder,
  recordActiveProviderSwitch,
} from './recordActiveProviderSwitch.js';

describe('recordActiveProviderSwitch', () => {
  it('records the active provider and model from the runtime status', async () => {
    const recorded: Array<[string, string]> = [];
    const failures: string[] = [];

    await recordActiveProviderSwitch(
      {
        recordProviderSwitch: (provider, model) => {
          recorded.push([provider, model]);
        },
      },
      {
        providerStatus: () => ({
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

  it('reports a status read failure through reportFailure and records nothing', async () => {
    const recorded: Array<[string, string]> = [];
    const failures: string[] = [];

    await recordActiveProviderSwitch(
      {
        recordProviderSwitch: (provider, model) => {
          recorded.push([provider, model]);
        },
      },
      {
        providerStatus: () => {
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

  it('does not read the runtime status when there is no recorder', async () => {
    let statusReads = 0;

    await recordActiveProviderSwitch(
      null,
      {
        providerStatus: () => {
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

describe('dialogProviderSwitchRecorder', () => {
  it('records through the Agent session owner in owner mode and ignores the raw integration', async () => {
    const events: unknown[] = [];
    const rawSwitches: Array<[string, string]> = [];
    const recorder = dialogProviderSwitchRecorder(
      'agent',
      (event) => {
        events.push(event);
      },
      {
        current: {
          recordProviderSwitch: (provider, model) => {
            rawSwitches.push([provider, model]);
          },
        },
      },
    );

    await recorder.recordProviderSwitch('codex', 'gpt-6-luna');

    expect({ events, rawSwitches }).toStrictEqual({
      events: [
        { type: 'provider_switch', provider: 'codex', model: 'gpt-6-luna' },
      ],
      rawSwitches: [],
    });
  });

  it('reads the raw integration at record time, so a swapped integration records the switch', async () => {
    const ownerEvents: unknown[] = [];
    const firstSwitches: Array<[string, string]> = [];
    const resumedSwitches: Array<[string, string]> = [];
    const integrationRef: {
      current: {
        recordProviderSwitch(provider: string, model: string): void;
      } | null;
    } = { current: null };
    const recorder = dialogProviderSwitchRecorder(
      undefined,
      (event) => {
        ownerEvents.push(event);
      },
      integrationRef,
    );

    await recorder.recordProviderSwitch('codex', 'before-any-integration');
    integrationRef.current = {
      recordProviderSwitch: (provider, model) => {
        firstSwitches.push([provider, model]);
      },
    };
    await recorder.recordProviderSwitch('codex', 'gpt-6-luna');
    integrationRef.current = {
      recordProviderSwitch: (provider, model) => {
        resumedSwitches.push([provider, model]);
      },
    };
    await recorder.recordProviderSwitch('anthropic', 'claude');

    expect({ ownerEvents, firstSwitches, resumedSwitches }).toStrictEqual({
      ownerEvents: [],
      firstSwitches: [['codex', 'gpt-6-luna']],
      resumedSwitches: [['anthropic', 'claude']],
    });
  });
});
