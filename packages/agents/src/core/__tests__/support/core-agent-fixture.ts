/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { buildAgent } from '../../../api/__tests__/helpers/agentHarness.js';
import { capturedAgentClient } from '../../../api/__tests__/helpers/agent-client-observation.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export async function buildCoreAgent(
  fixture: string,
): Promise<
  Awaited<ReturnType<typeof buildAgent>> & { agentClient: AgentClientContract }
> {
  const built = await buildAgent(fixture);
  return { ...built, agentClient: capturedAgentClient(built.agent) };
}
