/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { buildAgent } from '../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { capturedAgentClient } from '../../../agents/src/api/__tests__/helpers/agent-client-observation.js';

export async function buildCapturedAgent(
  ...args: Parameters<typeof buildAgent>
) {
  const value = await buildAgent(...args);
  return { ...value, client: capturedAgentClient(value.agent) };
}
