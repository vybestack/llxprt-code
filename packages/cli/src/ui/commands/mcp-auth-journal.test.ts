/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { buildAgent } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { performMcpOAuth } from './mcpAuth.js';
import type { CommandContext } from './types.js';
import type { TokenStorage } from '@vybestack/llxprt-code-mcp';

const storage: TokenStorage = {
  getCredentials: async () => null,
  setCredentials: async () => {},
  deleteCredentials: async () => {},
  listServers: async () => [],
  getAllCredentials: async () => new Map(),
  clearAll: async () => {},
};
const mcpServers = {
  journal: {
    httpUrl: 'https://journal-mcp.test/mcp',
    oauth: {
      enabled: true,
      clientId: 'journal-client',
      authorizationUrl: 'https://journal-auth.test/authorize',
      tokenUrl: 'https://journal-auth.test/token',
    },
  },
};

function contextFor(
  agent: NonNullable<CommandContext['services']['agent']>,
): CommandContext {
  const base = createMockCommandContext();
  return {
    ...base,
    recordingOwner: 'agent',
    services: { ...base.services, agent },
    ui: {
      ...base.ui,
      addItem: () => {
        throw new Error('Ledger write forbidden');
      },
    },
  };
}

async function readTexts(path: string): Promise<string[]> {
  const cursor = await NativeJournalCursor.open(path, {}, 10);
  try {
    return (await cursor.pageBack(10)).entries.flatMap((entry) =>
      entry.kind === 'projected' &&
      'text' in entry.item &&
      typeof entry.item.text === 'string'
        ? [entry.item.text]
        : [],
    );
  } finally {
    await cursor.close();
  }
}

describe('MCP authentication journal presentation', () => {
  const directory = useTempDir('mcp-auth-journal-');
  it('persists the start notice and manual URL before opening the browser without ledger writes', async () => {
    let opened = (): void => {};
    const browser = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let readPath: () => string | undefined = () => undefined;
    let observed: readonly string[] = [];
    let authorizationUrl = '';
    let browserError: unknown;
    const openBrowser = async (url: string): Promise<void> => {
      try {
        authorizationUrl = url;
        const path = readPath();
        if (!path) throw new Error('Missing journal path');
        observed = await readTexts(path);
      } catch (error) {
        browserError = error;
      } finally {
        opened();
      }
    };
    const built = await buildAgent('multi-turn-text.jsonl', {
      workingDir: directory(),
      folderTrust: false,
      mcpTokenStorage: storage,
      mcpHost: { openBrowser },
      mcpServers,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    let command: ReturnType<typeof performMcpOAuth> | undefined;
    let result: Awaited<ReturnType<typeof performMcpOAuth>> | undefined;
    try {
      await built.agent.session.setRecording({ enabled: true });
      readPath = () => built.agent.session.getRecording().path;
      command = performMcpOAuth(contextFor(built.agent), 'journal');
      const outcome = await Promise.race([
        browser.then(() => 'browser'),
        command.then(() => 'command'),
      ]);
      expect(outcome).toBe('browser');
      expect(browserError).toBeUndefined();
      expect(observed).toHaveLength(2);
      expect(observed[1]).toBe(
        "Starting OAuth authentication for MCP server 'journal'...",
      );
      expect(observed[0]).toContain(authorizationUrl);
    } finally {
      const disposal = built.agent.dispose();
      result = await command;
      await disposal;
      await built.cleanup();
    }
    expect(result).toMatchObject({ type: 'message', messageType: 'error' });
  }, 30000);
});
