/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  McpClient,
  MCPServerStatus,
  MCPOAuthProvider,
  MCPOAuthTokenStorage,
  type OAuthCredentials,
  type DiscoveredMCPPrompt,
} from '@vybestack/llxprt-code-mcp';
import { defaultBrowserLauncher } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import {
  buildToolGovernance,
  ToolRegistry,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-tools';
import type { Resource } from '@modelcontextprotocol/sdk/types.js';

async function stdioBehavior(): Promise<void> {
  const prompts = new Map<string, DiscoveredMCPPrompt>();
  const resources = new Map<string, Resource[]>();
  const trust = { isTrustedFolder: (): boolean => true };
  const messageBus = {
    requestConfirmation: async (): Promise<never> => {
      throw new Error('Unexpected confirmation request');
    },
  };
  const tools = new ToolRegistry(trust, messageBus, () => ({
    hideTaskAsync: false,
    lazyMcp: false,
    eagerServers: [],
    governance: buildToolGovernance({
      getEphemeralSettings: () => ({}),
      getExcludeTools: () => [],
    }),
  }));
  const client = new McpClient(
    { tokenStorage: createStorage(), openBrowser: defaultBrowserLauncher },
    unsupportedApprovalPolicy(),
    'local',
    {
      command: process.execPath,
      args: [
        join(process.cwd(), process.argv[3] ?? 'server.ts'),
        process.cwd(),
      ],
      timeout: 5000,
    },
    tools,
    {
      registerPrompt: (prompt) => {
        prompts.set(prompt.name, prompt);
      },
      removePromptsByServer: (name) => {
        for (const [key, prompt] of prompts)
          if (prompt.serverName === name) prompts.delete(key);
      },
    },
    {
      setResourcesForServer: (name, values) => {
        resources.set(name, values);
      },
      removeResourcesByServer: (name) => {
        resources.delete(name);
      },
    },
    { getDirectories: () => [], onDirectoriesChanged: () => () => {} },
    trust,
    false,
    '1.0.0',
  );
  try {
    await client.connect();
    assert.equal(client.getStatus(), MCPServerStatus.CONNECTED);
    assert.equal(client.getInstructions(), 'Use arithmetic locally.');
    await client.discover(trust);
    assert.equal(tools.getAllTools().length, 1);
    const tool = tools.getAllTools()[0];
    const prompt = prompts.get('explain');
    assert.ok(tool);
    assert.ok(prompt);
    assert.equal(resources.get('local')?.[0]?.uri, 'fixture:///arithmetic');
    const invocation = tool.build({ a: 19, b: 23 });
    const confirmation = await invocation.shouldConfirmExecute(
      new AbortController().signal,
    );
    assert.ok(confirmation && confirmation.type === 'mcp');
    await assert.rejects(
      confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlwaysAndSave),
      /Reusable MCP approval is unsupported/,
    );
    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    assert.ok(
      await tool
        .build({ a: 19, b: 23 })
        .shouldConfirmExecute(new AbortController().signal),
    );
    const result = await invocation.execute(new AbortController().signal);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.llmContent, [{ text: '42' }]);
    assert.deepEqual(await prompt.invoke({ value: 42 }), {
      messages: [
        { role: 'user', content: { type: 'text', text: 'Explain 42' } },
      ],
    });
    assert.deepEqual(await client.readResource('fixture:///arithmetic'), {
      contents: [
        { uri: 'fixture:///arithmetic', text: 'Addition combines quantities.' },
      ],
    });
    await client.disconnect();
    assert.equal(client.getStatus(), MCPServerStatus.DISCONNECTED);
    assert.equal(tools.getAllTools().length, 0);
    assert.equal(prompts.size, 0);
    assert.equal(resources.size, 0);
    const pid = Number(readFileSync('server.pid', 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(readFileSync('server.exit', 'utf8'), '0');
    const requests = readFileSync('requests', 'utf8');
    assert.deepEqual(requests.trim().split('\n'), [
      'prompts/list',
      'tools/list',
      'resources/list',
      'tools/call',
      'prompts/get',
      'resources/read',
    ]);
    await assert.rejects(
      prompt.invoke({ value: 'late' }),
      /MCP capability is no longer authorized/,
    );
    await assert.rejects(
      client.readResource('fixture:///arithmetic'),
      /Client is not connected/,
    );
    const late = await invocation.execute(new AbortController().signal);
    assert.ok(late.error);
    assert.match(late.error.message, /MCP capability is no longer authorized/);
    await client.disconnect();
    assert.equal(readFileSync('requests', 'utf8'), requests);
    process.stdout.write(`STDIO_OK child=${pid} exit=0 lateRequests=0\n`);
  } finally {
    await client.disconnect();
  }
}

async function authBehavior(unavailableHost: boolean): Promise<void> {
  const unavailable = new Error('fixture browser unavailable');
  const openBrowser = unavailableHost
    ? async (): Promise<void> => {
        throw unavailable;
      }
    : defaultBrowserLauncher;
  await assert.rejects(
    openBrowser('https://example.invalid/authorize?secret=must-not-leak'),
  );
  const events = new EventEmitter();
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error('auth fixture deadline')),
    5000,
  );
  const displayed = new Promise<string>((resolve) => {
    events.once('oauth-display-message', resolve);
  });
  const operation = MCPOAuthProvider.authenticate(
    { tokenStorage: createStorage(), openBrowser },
    'standalone',
    {
      clientId: 'local-fixture',
      authorizationUrl: 'https://example.invalid/authorize',
      tokenUrl: 'https://example.invalid/token',
    },
    undefined,
    events,
    controller.signal,
  );
  const outcome = operation.then(
    () => {
      throw new Error('Denial must not authenticate');
    },
    (error: unknown) => error,
  );
  try {
    const message = await Promise.race([
      displayed,
      outcome.then((error) => {
        throw error;
      }),
    ]);
    assert.match(message, /copy and paste this URL/);
    const authorization = message.match(
      /https:\/\/example\.invalid\/authorize\?\S+/,
    )?.[0];
    assert.ok(authorization);
    const url = new URL(authorization);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    const redirect = url.searchParams.get('redirect_uri');
    assert.ok(redirect);
    const callback = new URL(redirect);
    callback.searchParams.set('error', 'access_denied');
    const response = await fetch(callback, { signal: controller.signal });
    assert.equal(response.status, 200);
    await response.text();
    const failure = await outcome;
    assert.ok(failure instanceof Error);
    assert.equal(failure.message, 'OAuth error: access_denied');
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(Number(callback.port), () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
    process.stdout.write(
      `AUTH_OK browser=${unavailableHost ? 'unavailable-host' : 'standalone-default'} callbackClosed=true\n`,
    );
  } finally {
    controller.abort();
    await outcome;
    clearTimeout(deadline);
  }
}

if (process.argv[2] === 'stdio') await stdioBehavior();
else await authBehavior(process.argv[2] === 'unavailable-host');

function unsupportedApprovalPolicy(): import('@vybestack/llxprt-code-mcp').McpApprovalPolicy {
  return {
    evaluate: () => 'ask_user',
    approve: async () => {
      throw new Error('Reusable MCP approval is unsupported by this host');
    },
  };
}

function createStorage(): MCPOAuthTokenStorage {
  const credentials = new Map<string, OAuthCredentials>();
  return new MCPOAuthTokenStorage({
    getCredentials: async (name) => credentials.get(name) ?? null,
    setCredentials: async (value) => {
      credentials.set(value.serverName, value);
    },
    deleteCredentials: async (name) => {
      credentials.delete(name);
    },
    listServers: async () => [...credentials.keys()],
    getAllCredentials: async () => new Map(credentials),
    clearAll: async () => {
      credentials.clear();
    },
  });
}
