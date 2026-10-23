/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { NetworkFetch } from '@vybestack/llxprt-code-core';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createUnconfiguredBuiltinOwners,
  unavailableQuotaOAuthControl,
} from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import {
  createQuotaCommand,
  type QuotaCommandOperations,
} from './quotaCommand.js';
import type { SlashCommand } from './types.js';

interface QuotaOwner {
  readonly operations: QuotaCommandOperations;
  readonly requests: Array<{ readonly url: string; readonly method: string }>;
}

function creditsPayload(creditId: string): Record<string, unknown> {
  return {
    rate_limit_reset_credits: {
      available_count: 1,
      credits: [{ id: creditId }],
    },
  };
}

/**
 * One session's quota operations: its own OAuth control, network fetch and
 * endpoint, over a recording fetch that answers the consume endpoint.
 */
function quotaOwner(
  creditId: string,
  baseUrl: string,
  quotaLines: readonly string[],
): QuotaOwner {
  const requests: QuotaOwner['requests'] = [];
  const requestFetch: NetworkFetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(
      JSON.stringify({ code: 'reset', credit: { id: creditId } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const token = {
    access_token: `token-${creditId}`,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: `account-${creditId}`,
  };
  return {
    requests,
    operations: {
      oauthControl: {
        ...unavailableQuotaOAuthControl(),
        isAvailable: () => true,
        hasCodexToken: async () => true,
        listBuckets: async () => ['default'],
        getAllCodexRateLimitResetCredits: async () =>
          new Map([['default', creditsPayload(creditId)]]),
        readCodexBucketToken: async () => token,
      },
      fetch: requestFetch,
      baseUrlSetting: () => baseUrl,
      fetchQuotaLines: async () => [...quotaLines],
    },
  };
}

async function registeredQuota(
  operations: QuotaCommandOperations,
): Promise<SlashCommand> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          quotaCommand: createQuotaCommand(operations),
        },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const command = registry.getCommands().find((item) => item.name === 'quota');
  if (command === undefined) throw new Error('/quota is unavailable');
  return command;
}

function subcommand(command: SlashCommand, name: string): SlashCommand {
  const found = command.subCommands?.find((item) => item.name === name);
  if (found?.action === undefined) throw new Error(`/quota ${name} missing`);
  return found;
}

/** An invocation whose own session operations must never be consulted. */
function decoyInvocation(
  options: { readonly confirmed?: boolean; readonly raw?: string } = {},
) {
  const reported: string[] = [];
  const unavailable = (): never => {
    throw new Error('The invocation must not supply quota operations');
  };
  const context = createMockCommandContext({
    overwriteConfirmed: options.confirmed,
    invocation: { raw: options.raw ?? '', name: 'quota', args: '' },
    oauthControl: {
      ...unavailableQuotaOAuthControl(),
      getAllAnthropicUsageInfo: unavailable,
      getAllCodexUsageInfo: unavailable,
    },
    runtimeApi: {
      fetch: unavailable,
      getEphemeralSetting: unavailable,
      getActiveProviderName: unavailable,
    },
    ui: {
      addItem: (item: { readonly text?: string }) => {
        reported.push(item.text ?? '');
        return 0;
      },
    },
  });
  return { context, reported };
}

describe('quota command owner', () => {
  it('reports the quota lines of the registered owner, not the invocation', async () => {
    const left = quotaOwner('left', 'https://left.example/backend-api', [
      '## Left Quota Information',
    ]);
    const right = quotaOwner('right', 'https://right.example/backend-api', [
      '## Right Quota Information',
    ]);
    const leftQuota = await registeredQuota(left.operations);
    const rightQuota = await registeredQuota(right.operations);

    const leftRun = decoyInvocation();
    await subcommand(leftQuota, 'status').action!(leftRun.context, '');
    const rightRun = decoyInvocation();
    await rightQuota.action!(rightRun.context, '');

    expect(leftRun.reported).toStrictEqual(['## Left Quota Information']);
    expect(rightRun.reported).toStrictEqual(['## Right Quota Information']);
  });

  it('asks for confirmation using the invocation text before redeeming', async () => {
    const owner = quotaOwner('credit-a', 'https://a.example/backend-api', []);
    const reset = subcommand(await registeredQuota(owner.operations), 'reset');
    const run = decoyInvocation({ raw: '/quota reset codex' });

    const result = await reset.action!(run.context, 'codex');

    expect(result).toMatchObject({
      type: 'confirm_action',
      originalInvocation: { raw: '/quota reset codex' },
    });
    expect(owner.requests).toStrictEqual([]);
  });

  it('redeems through the registered owner fetch and endpoint only', async () => {
    const left = quotaOwner('credit-left', 'https://left.example/backend-api', [
      '## Left Quota Information',
    ]);
    const right = quotaOwner(
      'credit-right',
      'https://right.example/backend-api',
      ['## Right Quota Information'],
    );
    const reset = subcommand(await registeredQuota(left.operations), 'reset');
    await registeredQuota(right.operations);
    const run = decoyInvocation({ confirmed: true });

    await reset.action!(run.context, 'codex');

    expect(left.requests).toHaveLength(1);
    expect(left.requests[0]?.method).toBe('POST');
    expect(left.requests[0]?.url).toContain('left.example');
    expect(left.requests[0]?.url).toEndWith('/consume');
    expect(right.requests).toStrictEqual([]);
    expect(run.reported).toStrictEqual([
      'Rate-limit window reset successfully.',
      '## Left Quota Information',
    ]);
  });

  it('lists reset credits from the registered owner', async () => {
    const owner = quotaOwner('credit-a', 'https://a.example/backend-api', []);
    const credits = subcommand(
      await registeredQuota(owner.operations),
      'credits',
    );
    const run = decoyInvocation();

    await credits.action!(run.context, '');

    expect(run.reported).toHaveLength(1);
    expect(run.reported[0]).toContain('Available reset credits: 1');
  });
});
