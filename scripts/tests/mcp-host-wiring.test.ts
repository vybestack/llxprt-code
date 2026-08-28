/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  CoreEvent,
  coreEvents,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import {
  emitHostFeedback,
  MCP_CLIENT_UPDATE_EVENT,
  openHostBrowser,
  resetMcpHostServices,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { wireMcpHostServices as wireCli } from '../../packages/cli/src/mcpHostWiring.js';
import { wireMcpHostServices as wireA2a } from '../../packages/a2a-server/src/mcpHostWiring.js';
import { wireMcpHostServices as wireAgentApi } from '../../packages/agents/src/api/mcpHostWiring.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const compositionRoots = [
  ['CLI', wireCli],
  ['A2A server', wireA2a],
  ['Agent API', wireAgentApi],
] as const;
const originalNodeEnv = process.env.NODE_ENV;
const originalBrowserLaunchOptIn =
  process.env.LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS;
});

afterEach(() => {
  resetMcpHostServices();
  restoreEnvironmentVariable('NODE_ENV', originalNodeEnv);
  restoreEnvironmentVariable(
    'LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS',
    originalBrowserLaunchOptIn,
  );
});

function restoreEnvironmentVariable(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('application MCP host wiring', () => {
  it.each(compositionRoots)(
    '%s sends MCP feedback through core events',
    (_name, wire) => {
      const received: UserFeedbackPayload[] = [];
      const listener = (payload: UserFeedbackPayload): void => {
        received.push(payload);
      };
      const failure = new Error('MCP failure');
      coreEvents.on(CoreEvent.UserFeedback, listener);
      try {
        wire();
        emitHostFeedback('error', 'Server failed', failure);
      } finally {
        coreEvents.off(CoreEvent.UserFeedback, listener);
      }

      expect(received).toEqual([
        {
          severity: 'error',
          message: 'Server failed',
          error: failure,
        },
      ]);
    },
  );

  it.each(compositionRoots)(
    '%s delegates MCP browser opening to the secure core launcher',
    async (_name, wire) => {
      wire();

      await expect(openHostBrowser('javascript:alert(1)')).rejects.toThrow(
        'Browser launch is disabled during tests',
      );
    },
  );

  it('keeps the MCP client-update event compatible with core listeners', () => {
    expect(MCP_CLIENT_UPDATE_EVENT).toBe(CoreEvent.McpClientUpdate);
  });

  it('registers host services in each application startup function', () => {
    const startupSources = [
      ['packages/cli/src/cli.tsx', 'export async function main()'],
      ['packages/a2a-server/src/http/app.ts', 'export async function main()'],
      [
        'packages/agents/src/api/createAgent.ts',
        'export async function createAgent',
      ],
      [
        'packages/agents/src/api/fromConfig.ts',
        'export async function fromConfig',
      ],
    ] as const;

    for (const [file, functionMarker] of startupSources) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      const functionStart = source.indexOf(functionMarker);
      const wiringCall = source.indexOf(
        'wireMcpHostServices();',
        functionStart,
      );
      expect(
        functionStart,
        `${file} must contain ${functionMarker}`,
      ).toBeGreaterThan(-1);
      expect(
        wiringCall,
        `${file} must wire MCP host services during startup`,
      ).toBeGreaterThan(functionStart);
      expect(
        source.slice(functionStart, wiringCall),
        `${file} must wire MCP before asynchronous startup work`,
      ).not.toContain('await ');
    }
  });
});
