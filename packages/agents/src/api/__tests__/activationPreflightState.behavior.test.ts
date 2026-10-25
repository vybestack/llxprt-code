import { afterEach, beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { AgentActivationOperation } from '../activation-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap receipts', () => {
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
  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();
  const routes: RouteBPreflight[] = [];

  afterEach(async () => {
    for (const route of routes.splice(0).reverse()) await route.close();
  });

  it('adopts the real Config once without repeating authentication', async () => {
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
      config: { interactive: true },
    });
    routes.push(route);
    await route.prepare();
    let activation: AgentActivationOperation | undefined;
    route.preflight.transferActivation((selected) => {
      activation = selected;
    });
    if (activation === undefined) throw new Error('Missing activation');

    const result = await activation.preflight(intent);
    if (!result.token) throw new Error('Missing receipt');
    const history = await activation.readHistory();
    const contentConfig = route.config.getContentGeneratorConfig();
    const agent = await AgentProfilePreflight.createForegroundAgent(
      route.preflight,
      result.token,
      intent,
      {},
    );
    expect(await agent.getHistory()).toStrictEqual(history);
    expect(route.config.getContentGeneratorConfig()).toBe(contentConfig);
    await agent.dispose();
    await expect(
      AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      ),
    ).rejects.toThrow('Foreground construction was already accepted');
  });
});
