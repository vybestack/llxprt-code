/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '../../agent.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionClientOwner } from '../../../session/session-client-owner.js';

const observations = new WeakMap<
  Agent,
  { clients: AgentClientContract[]; config: Config }
>();

export async function observeAgentConstruction(
  build: () => Promise<Agent>,
  factory?: AgentClientFactory,
): Promise<Agent> {
  const clients: AgentClientContract[] = [];
  let config: Config | undefined;
  const create = SessionClientOwner.create;
  SessionClientOwner.create = async (session, acquisition, host) => {
    config = session.config;
    const construct = factory ?? acquisition.factory;
    return create(
      session,
      {
        ...acquisition,
        factory: (...args) => {
          const client = construct(...args);
          if (client !== undefined) clients.push(client);
          return client;
        },
      },
      host,
    );
  };
  try {
    const agent = await build();
    if (config === undefined)
      throw new Error('Agent did not acquire a session client');
    observations.set(agent, { clients, config });
    return agent;
  } finally {
    SessionClientOwner.create = create;
  }
}

export function observedAgentConfig(agent: Agent): Config {
  const observed = observations.get(agent);
  if (observed === undefined)
    throw new Error('Agent construction was not observed');
  return observed.config;
}

/** Identify the factory result serving the public cold read, without consuming history. */
export function capturedAgentClient(agent: Agent): AgentClientContract {
  const observed = observations.get(agent);
  if (observed === undefined)
    throw new Error('Agent construction was not observed');
  const receivers: AgentClientContract[] = [];
  const restores = observed.clients.map((client) => {
    const original = client.streamHistory;
    const own = Object.prototype.hasOwnProperty.call(client, 'streamHistory');
    client.streamHistory = (...args) => {
      receivers.push(client);
      return original.call(client, ...args);
    };
    return (): void => {
      if (own) client.streamHistory = original;
      else Reflect.deleteProperty(client, 'streamHistory');
    };
  });
  try {
    agent.streamHistory();
  } finally {
    for (const restore of restores) restore();
  }
  if (receivers.length !== 1)
    throw new Error(
      `Expected one public history receiver, got ${receivers.length}`,
    );
  return receivers[0];
}
