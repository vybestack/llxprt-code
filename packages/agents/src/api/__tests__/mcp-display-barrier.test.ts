/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';
import type { TokenStorage } from '@vybestack/llxprt-code-mcp';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const storage: TokenStorage = {
  getCredentials: async () => null,
  setCredentials: async () => {},
  deleteCredentials: async () => {},
  listServers: async () => [],
  getAllCredentials: async () => new Map(),
  clearAll: async () => {},
};

function buildDisplayAgent(openBrowser: (url: string) => Promise<void>) {
  return buildAgent('multi-turn-text.jsonl', {
    folderTrust: false,
    mcpTokenStorage: storage,
    mcpHost: { openBrowser },
    mcpServers: {
      journal: {
        httpUrl: 'https://journal-mcp.test/mcp',
        oauth: {
          enabled: true,
          clientId: 'journal-client',
          authorizationUrl: 'https://journal-auth.test/authorize',
          tokenUrl: 'https://journal-auth.test/token',
        },
      },
    },
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
}

describe('MCP OAuth display durability barrier', () => {
  it('does not open the browser until the async display sink acknowledges its URL', async () => {
    const displayed = gate();
    const release = gate();
    const browser = gate();
    let browserStarts = 0;
    const built = await buildDisplayAgent(async () => {
      browserStarts++;
      browser.release();
    });
    const work = built.agent.mcp
      .authenticate('journal', async (message) => {
        expect(message).toContain('https://journal-auth.test/authorize');
        displayed.release();
        await release.promise;
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    try {
      await displayed.promise;
      await Promise.resolve();
      expect(browserStarts).toBe(0);
      release.release();
      await browser.promise;
      expect(browserStarts).toBe(1);
      const disposal = built.agent.dispose();
      expect(await work).toHaveProperty('name', 'AbortError');
      await disposal;
    } finally {
      release.release();
      await built.cleanup();
      await work;
    }
  }, 30000);

  it('joins a pending display write on disposal and never opens the browser after cancellation', async () => {
    const displayed = gate();
    const release = gate();
    let browserStarts = 0;
    const built = await buildDisplayAgent(async () => {
      browserStarts++;
    });
    const work = built.agent.mcp
      .authenticate('journal', async () => {
        displayed.release();
        await release.promise;
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    let disposal: Promise<void> | undefined;
    try {
      await displayed.promise;
      let disposed = false;
      disposal = built.agent.dispose();
      void disposal.then(() => {
        disposed = true;
      });
      await Promise.resolve();
      expect(disposed).toBe(false);
      release.release();
      expect(await work).toHaveProperty('name', 'AbortError');
      await disposal;
      expect(browserStarts).toBe(0);
    } finally {
      release.release();
      await built.cleanup();
      await disposal;
      await work;
    }
  }, 30000);

  it('propagates a rejected display write without opening the browser', async () => {
    let browserStarts = 0;
    const built = await buildDisplayAgent(async () => {
      browserStarts++;
    });
    const error = new Error('journal write failed');
    try {
      await expect(
        built.agent.mcp.authenticate('journal', async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(browserStarts).toBe(0);
    } finally {
      await built.cleanup();
    }
  }, 30000);
});
