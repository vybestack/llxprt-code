/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from '../../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import {
  openRouteAAgent,
  type RouteAAgent,
} from '../../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { runCleanupSteps } from '../../../../../agents/src/core/subagent-cleanup.js';

/**
 * Agents for owner-session tests, built through the production `fromConfig`
 * entry point. The first agent opened in a test gets a fresh working
 * directory; every later one is an independent agent (own Config, client and
 * history) over that same directory, so they share one chats directory. The
 * user config directory is a temp directory so recordings never land in the
 * real one. Call inside `describe`.
 */
export function useOwnerSessionAgents(): () => Promise<RouteAAgent> {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  let home: string;
  let previousHome: string | undefined;
  let routes: RouteAAgent[] = [];
  beforeEach(async () => {
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    home = await mkdtemp(join(tmpdir(), 'owner-session-home-'));
    process.env.LLXPRT_CONFIG_HOME = home;
  });
  afterEach(async () => {
    const opened = routes;
    routes = [];
    await runCleanupSteps([
      ...[...opened].reverse().map((route) => () => route.close()),
      () => {
        if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
        else process.env.LLXPRT_CONFIG_HOME = previousHome;
      },
      () => rm(home, { recursive: true, force: true }),
    ]);
  });
  return async () => {
    const first = routes.at(0);
    const route = await openRouteAAgent({
      config:
        first === undefined
          ? { interactive: true }
          : { interactive: true, workingDir: first.directory },
    });
    routes.push(route);
    return route;
  };
}
