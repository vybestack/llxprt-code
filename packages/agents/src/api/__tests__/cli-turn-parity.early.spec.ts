import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

import { describe, expect, it } from 'bun:test';

import { drain } from './helpers/agentHarness.js';

describe('CLI turn-parity (early RED) @plan:PLAN-20260621-COREAPIREMED.P07 @requirement:REQ-INT-001 @requirement:REQ-INT-002', () => {
  useFakeResponsesReplay('parity-toolcall.jsonl');

  useConsumerPromptDirectory();

  const builtCredentials = useOwnedCredentials();

  it('EP1 fromConfig adopts the external Config and drives a terminal done (REQ-INT-001)', async () => {
    const built = await openRouteAAgent({
      authority: builtCredentials().authority,
      config: { interactive: true, includeDirectories: [process.cwd()] },
    });
    try {
      const agent = built.agent;
      // REQ-INT-001: the stream yields exactly one terminal done.
      const events = await drain(agent.stream('hello'));
      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);

      // REQ-INT-001: the agent is bound to the caller's Config, so a change
      // made on that Config is what the agent reads.
      built.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
    } finally {
      await built.close();
    }
  }, 30000);
});
