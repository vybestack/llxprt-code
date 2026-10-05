/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';

/** Test-only eager recipient. Retains every row for existing value assertions. */
export async function collectAgentHistory(
  agent: Agent,
): Promise<AgentMessage[]> {
  const rows: AgentMessage[] = [];
  for await (const row of agent.streamHistory()) rows.push(row);
  return rows;
}
