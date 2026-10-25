import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach as afterFixtureTest,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { cleanupAfterFailure } from '../../../../agents/src/core/subagent-cleanup.js';
import {
  OwnerView,
  ModelEventView,
} from '../../__tests__/runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import { act } from 'react';
import { render } from 'ink-testing-library';

import { SessionController } from '../containers/SessionController.js';
import { createRuntimeOwnerFeatures } from '../../__tests__/runtime-owner-features-fixture.js';
import {
  RuntimeContextProvider,
  type RuntimeApi,
} from '../../__tests__/runtime-context-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const makeFixtureFilesystem = installTestWorkspaceFilesystem();

let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;

function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

const composeFixtureRuntime = installWorkspaceRuntimeFixture();

interface BridgeRoot {
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

async function openBridgeRoot(
  authority: RouteBPreflight['authority'],
): Promise<BridgeRoot> {
  const route = await openRouteBPreflight({
    authority,
    config: {
      interactive: true,
      includeDirectories: [process.cwd()],
      sessionId: 'shared-bridge-label',
    },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  const close = async (): Promise<void> => {
    try {
      await route.close();
    } finally {
      await settingsOwner.dispose();
    }
  };
  try {
    for (const [key, value] of Object.entries(
      route.config.getInitialSettings(),
    ))
      route.settings.set(key, value);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    const agent = await route.createAgent();
    return { route, settingsOwner, agent, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}

describe('interactive runtime owner bridge', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('multi-turn-text.jsonl');

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('keeps two mounted roots with identical runtime labels independent across updates and unmounts', async () => {
    const first = await openBridgeRoot(firstCredentials().authority);
    const second = await openBridgeRoot(secondCredentials().authority).catch(
      (primary: unknown) => cleanupAfterFailure(primary, first.close),
    );
    const a = first.agent;
    const b = second.agent;
    const firstCallerSettingsOwner = first.settingsOwner;
    const secondCallerSettingsOwner = second.settingsOwner;
    const firstCallerConfig = first.route.config;
    const secondCallerConfig = second.route.config;
    firstCallerSettingsOwner.writeUserParameter('bridge-owner-key', 'first');
    secondCallerSettingsOwner.writeUserParameter('bridge-owner-key', 'second');
    firstCallerSettingsOwner.chooseModel('first-model');
    secondCallerSettingsOwner.chooseModel('second-model');
    const captured: { left?: RuntimeApi; right?: RuntimeApi } = {};
    const left = render(
      <RuntimeContextProvider
        requestFetch={a.sessionClient.fetch}
        agent={a}
        owner={createRuntimeOwnerFeatures(
          a.providerReads.inspection,
          fixturePaths().directories,
          createSessionModelCommand(a),
          firstCallerSettingsOwner,
          a.workspace,
          a.modelParameters,
          a.settings,
          a.toolFormat,
          a.providerReads,
          a.auth.keys,
          () => a.providerReads.readOpenAIInfo(),
        )}
      >
        <SessionController
          config={composeFixtureRuntime(
            firstCallerConfig,
            a,
            firstCallerSettingsOwner,
          )}
        >
          <OwnerView
            label="left"
            onApi={(api) => {
              captured.left = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    const right = render(
      <RuntimeContextProvider
        requestFetch={b.sessionClient.fetch}
        agent={b}
        owner={createRuntimeOwnerFeatures(
          b.providerReads.inspection,
          fixturePaths().directories,
          createSessionModelCommand(b),
          secondCallerSettingsOwner,
          b.workspace,
          b.modelParameters,
          b.settings,
          b.toolFormat,
          b.providerReads,
          b.auth.keys,
          () => b.providerReads.readOpenAIInfo(),
        )}
      >
        <SessionController
          config={composeFixtureRuntime(
            secondCallerConfig,
            b,
            secondCallerSettingsOwner,
          )}
        >
          <OwnerView
            label="right"
            onApi={(api) => {
              captured.right = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    try {
      expect(left.lastFrame()).toContain('left:fake:first-model:first');
      expect(right.lastFrame()).toContain('right:fake:second-model:second');
      if (!captured.left || !captured.right)
        throw new Error('Root callbacks unavailable');
      await captured.left.setActiveToolFormatOverride('openai');
      await captured.right.setActiveToolFormatOverride('kimi');
      expect((await captured.left.getActiveToolFormatState()).override).toBe(
        'openai',
      );
      expect((await captured.right.getActiveToolFormatState()).override).toBe(
        'kimi',
      );
      firstCallerSettingsOwner.chooseModel('first-event-model');
      secondCallerSettingsOwner.chooseModel('second-event-model');
      act(() => {
        firstCallerSettingsOwner.publishModelProfile({
          model: 'first-event-model',
          displayLabel: 'first-event-model',
        });
        secondCallerSettingsOwner.publishModelProfile({
          model: 'second-event-model',
          displayLabel: 'second-event-model',
        });
      });
      expect(left.lastFrame()).toContain('event-model:fake:first-event-model');
      expect(right.lastFrame()).toContain(
        'event-model:fake:second-event-model',
      );
      left.unmount();
      expect(
        (await captured.right.getActiveToolFormatState()).currentFormat,
      ).toBe('kimi');
      secondCallerSettingsOwner.chooseModel('updated-model');
      act(() =>
        secondCallerSettingsOwner.publishModelProfile({
          model: 'updated-model',
          displayLabel: 'updated-model',
        }),
      );
      right.rerender(
        <RuntimeContextProvider
          requestFetch={b.sessionClient.fetch}
          agent={b}
          owner={createRuntimeOwnerFeatures(
            b.providerReads.inspection,
            fixturePaths().directories,
            createSessionModelCommand(b),
            secondCallerSettingsOwner,
            b.workspace,
            b.modelParameters,
            b.settings,
            b.toolFormat,
            b.providerReads,
            b.auth.keys,
            () => b.providerReads.readOpenAIInfo(),
          )}
        >
          <SessionController
            config={composeFixtureRuntime(
              secondCallerConfig,
              b,
              secondCallerSettingsOwner,
            )}
          >
            <OwnerView label="right" />
            <ModelEventView />
          </SessionController>
        </RuntimeContextProvider>,
      );
      expect(right.lastFrame()).toContain('right:fake:updated-model:second');
      expect(right.lastFrame()).toContain('event-model:fake:updated-model');
    } finally {
      right.unmount();
      await a.dispose();
      await b.dispose();
      await first.close();
      await second.close();
    }
  }, 30000);
});
