/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Command-to-footer agreement for issue #3954: running `/model <id>` through
 * the real command chain moves the footer label observed by the mounted
 * `useModelRuntimeSync` hook from `<profile>:<old model>` to
 * `<profile>:<new model>`. Nothing here emits a core event; the only producer
 * is `Agent.setModel` behind `createSessionModelCommand`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, useState } from 'react';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { modelCommand } from '../commands/modelCommand.js';
import { useModelRuntimeSync } from '../containers/AppContainer/hooks/useModelRuntimeSync.js';
import {
  createCliModelIdentityRuntime,
  resolveModelIdentity,
} from './modelIdentity.js';

const PROFILE_NAME = 'gpt-sol-high';

function mountFooterLabel(agent: Agent): { readonly label: () => string } {
  const runtime = createCliModelIdentityRuntime(agent);
  const resolveModelDisplayLabel = (): string => resolveModelIdentity(runtime);
  const config = {
    getModel: (): string => agent.getModel(),
    getEphemeralSetting: (): undefined => undefined,
  };
  const getActiveModelName = (): string => agent.getModel();
  const getActiveProviderName = (): string => agent.getProvider();
  const unusedContextLimit = (): void => {};

  const mounted = renderHook(() => {
    const [model, setModel] = useState(agent.getModel());
    const [label, setLabel] = useState(resolveModelDisplayLabel());
    useModelRuntimeSync({
      config,
      currentModel: model,
      setCurrentModel: setModel,
      currentModelLabel: label,
      setCurrentModelLabel: setLabel,
      getActiveModelName,
      getActiveProviderName,
      resolveModelDisplayLabel,
      setContextLimit: unusedContextLimit,
    });
    return label;
  });
  return { label: () => mounted.result.current };
}

describe('footer label after the /model command (#3954)', () => {
  let agent: Agent;
  let previousFake: string | undefined;

  beforeEach(async () => {
    previousFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
        import.meta.url,
      ),
    );
    agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: process.cwd(),
      sessionId: 'model-identity-publication',
    });
    await agent.profiles.applySnapshot(
      {
        version: 1,
        provider: 'fake',
        model: 'fake-model',
        modelParams: {},
        ephemeralSettings: {},
      },
      { profileName: PROFILE_NAME },
    );
  });

  afterEach(async () => {
    await agent.dispose();
    if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
  });

  it('moves the mounted footer label from <profile>:<old model> to <profile>:<new model>', async () => {
    const footer = mountFooterLabel(agent);
    expect(footer.label()).toBe(`${PROFILE_NAME}:fake-model`);
    const context = createMockCommandContext({
      runtimeApi: { setActiveModel: createSessionModelCommand(agent) },
    });

    const result = await act(async () =>
      modelCommand.action?.(context, 'fake-model-next'),
    );

    expect(result).toMatchObject({ type: 'message', messageType: 'info' });
    expect(footer.label()).toBe(`${PROFILE_NAME}:fake-model-next`);
  });
});
