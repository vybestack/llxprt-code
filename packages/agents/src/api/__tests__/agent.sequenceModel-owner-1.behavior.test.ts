/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { projectCurrentSequenceModel } from '../agentStatsProjector.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

describe('getCurrentSequenceModel delegation @plan:PLAN-20260621-COREAPIREMED.P13 @requirement:REQ-003', () => {
  useFakeResponsesReplay('plain-text.jsonl');
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

  const builtCredentials = useOwnedCredentials();
  let built: RouteAAgent | undefined;
  afterEach(async () => {
    await built?.close();
    built = undefined;
  });

  const observeConsumerFallbacks = async () => {
    built = await openRouteAAgent({ authority: builtCredentials().authority });
    const { agent: actualAgent } = built;
    const fallbackModel = built.config.getModel();
    const observations: Array<{
      reportedModel: string;
      presentResult: string;
      absentResult: string;
      absentModel: string;
      fallbackModel: string;
    }> = [];
    const fallbackProperty = fc.asyncProperty(
      fc.string({ minLength: 1 }),
      (reportedModel) => {
        const present = (): string | null =>
          projectCurrentSequenceModel({
            getCurrentSequenceModel: () => reportedModel,
          });
        const absent = (): string | null =>
          projectCurrentSequenceModel({ getCurrentSequenceModel: () => null });
        const presentResult = present() ?? actualAgent.getModel();
        const absentResult = absent() ?? actualAgent.getModel();
        const absentModel = actualAgent.getModel();
        observations.push({
          reportedModel,
          presentResult,
          absentResult,
          absentModel,
          fallbackModel,
        });
        return Promise.resolve(
          presentResult === reportedModel &&
            absentResult === absentModel &&
            absentModel === fallbackModel,
        );
      },
    );
    return { fallbackProperty, observations };
  };

  it('PROP consumer fallback: (agent.getCurrentSequenceModel() ?? agent.getModel()) equals the client reported sequence model when present, else equals agent.getModel() @requirement:REQ-003 @scenario:property-consumer-fallback @given:a random model string and an agent whose client reports it @when:a consumer computes seq ?? agent.getModel() @then:the result equals the reported model; and when the client reports null the result equals agent.getModel()', async () => {
    const { fallbackProperty, observations } = await observeConsumerFallbacks();
    await fc.assert(fallbackProperty);
    expect(
      observations.map(({ presentResult }) => presentResult),
    ).toStrictEqual(observations.map(({ reportedModel }) => reportedModel));
    expect(observations.map(({ absentResult }) => absentResult)).toStrictEqual(
      observations.map(({ absentModel }) => absentModel),
    );
    expect(observations.map(({ absentModel }) => absentModel)).toStrictEqual(
      observations.map(({ fallbackModel }) => fallbackModel),
    );
  });

  // ─── Genuine null contract via the REAL path (distinct from T9b's injected
  // seam): proves the real fake-provider client reports null sequence model
  // (no load-balancer sticky model under the fake seam) and that the public
  // fromConfig-built agent surfaces that genuine null. This is NOT a reverse
  // test — null IS the real contract value here.
  it('T9b-real fromConfig-built agent over the fake seam returns null (genuine null contract, real client) @requirement:REQ-003 @scenario:null-contract-real @given:a real agent built via fromConfig over the fake-provider seam @when:agent.getCurrentSequenceModel() @then:returns null (the real fake-provider client reports no sequence model)', async () => {
    built = await openRouteAAgent({ authority: builtCredentials().authority });
    expect(built.agent.getCurrentSequenceModel()).toBeNull();
  });
});
