/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  successful,
  withOwners,
  type Observation,
} from '../../api/__tests__/turn-revision-capture.fixture.js';
import { usePromptFixture } from '../../api/__tests__/helpers/prompt-fixture.js';

const NOT_HELD = 0;

async function saveProfile(name: string, endpoint: string): Promise<void> {
  await new ProfileManager().saveProfile(name, {
    version: 1,
    provider: 'openai',
    model: 'capture-a',
    modelParams: {},
    ephemeralSettings: {
      'base-url': endpoint,
      'auth-key': 'turn-capture-local-only',
    },
  });
}

function modelInfos(observation: Observation): Array<{
  readonly profileName: string | null | undefined;
  readonly displayLabel: string | undefined;
}> {
  return observation.events.flatMap((event) =>
    event.type === 'model-info'
      ? [
          {
            profileName: event.info.profileName,
            displayLabel: event.info.displayLabel,
          },
        ]
      : [],
  );
}

describe('model info names the profile admitted for the stream', () => {
  usePromptFixture();

  it('reports the admitted profile name and label', async () => {
    await withOwners(
      async (a, _b, endpoint, _sibling, start) => {
        await saveProfile('myprofile', endpoint.url);
        await a.profiles.load('myprofile');
        const observation = await start(a, 'Which profile?');
        successful(observation);
        expect(modelInfos(observation)).toStrictEqual([
          { profileName: 'myprofile', displayLabel: 'myprofile:capture-a' },
        ]);
      },
      false,
      false,
      NOT_HELD,
    );
  }, 30_000);

  it('keeps the admitted profile while a competing profile load is refused as busy', async () => {
    await withOwners(async (a, _b, endpoint, _sibling, start) => {
      await saveProfile('myprofile', endpoint.url);
      await saveProfile('other', endpoint.url);
      await a.profiles.load('myprofile');
      const held = start(a, 'Hold the response');
      await endpoint.entered;
      await expect(a.profiles.load('other')).rejects.toBeInstanceOf(
        AgentBusyError,
      );
      endpoint.release();
      const observation = await held;
      successful(observation);
      expect(modelInfos(observation)).toStrictEqual([
        { profileName: 'myprofile', displayLabel: 'myprofile:capture-a' },
      ]);
      await a.profiles.load('other');
    });
  }, 30_000);

  it('reports no profile and the bare model when none is admitted', async () => {
    await withOwners(
      async (a, _b, _endpoint, _sibling, start) => {
        const observation = await start(a, 'No profile');
        successful(observation);
        expect(modelInfos(observation)).toStrictEqual([
          { profileName: null, displayLabel: 'capture-a' },
        ]);
      },
      false,
      false,
      NOT_HELD,
    );
  }, 30_000);
});
