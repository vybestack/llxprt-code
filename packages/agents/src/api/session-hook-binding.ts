import type { ToolSelection } from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export interface SessionClientHookBinding {
  readonly token: symbol;
  readonly readClient: () => AgentClientContract;
  readonly publishTools: () => Promise<void>;
  readonly publishInstructions: () => Promise<void>;
  readonly acceptSkillPublication?: () => (
    workspace: ReturnType<ToolSelection['getFunctionDeclarations']>,
  ) => Promise<void>;
  readonly reloadHooks?: () => Promise<void>;
}

export function bindHookReload<T extends { readonly token: symbol }>(
  bindings: readonly T[],
  token: symbol,
  reloadHooks: () => Promise<void>,
): Array<T & { readonly reloadHooks?: () => Promise<void> }> {
  if (!bindings.some((binding) => binding.token === token))
    throw new Error('Hook reload requires an existing session binding');
  return bindings.map((binding) =>
    binding.token === token ? { ...binding, reloadHooks } : binding,
  );
}

export interface SessionHookReloadBinding {
  readonly reloadHooks?: () => Promise<void>;
}

export function createHookReloadBinding(
  read: () => readonly SessionClientHookBinding[],
  publish: (bindings: readonly SessionClientHookBinding[]) => void,
): (token: symbol, reloadHooks: () => Promise<void>) => () => void {
  return (token, reloadHooks) => {
    publish(bindHookReload(read(), token, reloadHooks));
    return () => publish(unbindHookReload(read(), token));
  };
}

export async function reloadSessionHooks(
  bindings: readonly SessionHookReloadBinding[],
): Promise<void> {
  await Promise.all(bindings.map((binding) => binding.reloadHooks?.()));
}

export function unbindHookReload(
  bindings: readonly SessionClientHookBinding[],
  token: symbol,
): SessionClientHookBinding[] {
  return bindings.map((binding) => {
    if (binding.token !== token) return binding;
    const { reloadHooks: _reloadHooks, ...session } = binding;
    return session;
  });
}

export function retainSessionBinding(
  bindings: readonly SessionClientHookBinding[],
  token: symbol,
  readClient: SessionClientHookBinding['readClient'],
  publishTools: SessionClientHookBinding['publishTools'],
  publishInstructions: SessionClientHookBinding['publishInstructions'],
  bindInstructions: (
    read: () => string | undefined,
    release: () => void,
  ) => void,
  readInstructions: () => string | undefined,
  release: () => void,
  acceptSkillPublication: SessionClientHookBinding['acceptSkillPublication'],
): readonly SessionClientHookBinding[] {
  if (bindings.some((binding) => binding.token === token)) return bindings;
  bindInstructions(readInstructions, release);
  return [
    ...bindings,
    {
      token,
      readClient,
      publishTools,
      publishInstructions,
      acceptSkillPublication,
    },
  ];
}

export function trackSessionPublication(
  operations: Set<Promise<void>>,
  publishing: Promise<void>,
): Promise<void> {
  const operation = publishing.then(
    () => {
      operations.delete(operation);
    },
    (error: unknown) => {
      operations.delete(operation);
      throw error;
    },
  );
  operations.add(operation);
  return operation;
}
export async function publishSessionTools(
  read: () => readonly SessionClientHookBinding[],
  stopped: () => boolean,
): Promise<void> {
  const clients = new Set<ReturnType<SessionClientHookBinding['readClient']>>();
  for (const binding of read()) {
    if (!read().includes(binding)) continue;
    const client = binding.readClient();
    if (!clients.has(client)) {
      clients.add(client);
      await binding.publishTools();
      if (stopped()) return;
    }
  }
}

export async function clearSessionTools(
  bindings: readonly SessionClientHookBinding[],
): Promise<unknown[]> {
  const clients = new Set<AgentClientContract>();
  const results = await Promise.allSettled(
    bindings.map((binding) =>
      Promise.resolve().then(() => {
        const client = binding.readClient();
        if (clients.has(client)) return;
        clients.add(client);
        client.clearTools();
      }),
    ),
  );
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}
