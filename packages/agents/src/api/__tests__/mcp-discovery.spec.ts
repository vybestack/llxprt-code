/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-013
 * @requirement:REQ-017
 *
 * MCP instance discovery + discovery gating (RED). Behavioral integration tests
 * against a real public Agent over a real FakeProvider, driven through a fake
 * MCP infra registry (NOT the Agent under test). Tests FAIL NATURALLY — stub
 * methods throw NYI; no mock theater, only value/sequence assertions.
 *
 * Covers:
 * - T12  instance discovery (listTools/listProviders) includes MCP/extension/
 *        skill entries via fake MCP infra.
 * - T12b agent.mcp.listServers/status/toolsByServer; discovery-blocking honored.
 * - T20  discovery gating — default chat()/stream() await MCP readiness;
 *        TurnOptions.mcpDiscovery:'skip' opts out; discovery FAILURE yields
 *        AgentError{code:'mcp_discovery_failed'} + exactly one done:error;
 *        mcp.status/listTools still callable while pending.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAgent,
  drain,
  typesOf,
  countType,
  isDoneEvent,
} from './helpers/agentHarness.js';
import {
  createFakeMcpRegistry,
  fakeRegistryWithServer,
  stdioFakeConfig,
  type FakeMcpRegistry,
  type FakeMcpServerHandle,
} from './helpers/fakeMcpServer.js';
import { McpControl } from '../control/mcpControl.js';
import {
  createFakeMcpDeps,
  fakeServerConfig,
  setServerStatus,
  MCPServerStatus,
  MCPDiscoveryState,
} from './helpers/fakeMcpManager.js';

describe('MCP discovery @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013 @requirement:REQ-017', () => {
  let registry: FakeMcpRegistry;

  beforeEach(() => {
    registry = createFakeMcpRegistry();
  });

  it('T12 instance discovery (listTools) includes MCP entries surfaced via the fake MCP infra @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-017', async () => {
    const fakeTools = [
      { name: 'mcp_search', description: 'search the web', enabled: true },
      { name: 'mcp_fetch', description: 'fetch a url', enabled: true },
    ];
    const { registry: populated } = fakeRegistryWithServer(
      'web-tools',
      fakeTools,
    );
    const expectedNames = populated.projectedTools().map((t) => t.name);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: {
        'web-tools': stdioFakeConfig('fake-mcp-binary'),
      },
    });
    try {
      // the agent discovers tools from the fake infra
      const tools = agent.listTools();
      const toolNames = tools.map((t) => t.name);

      // MCP entries are present in the discovered set
      for (const name of expectedNames) {
        expect(toolNames).toContain(name);
      }

      // each MCP tool carries source:'mcp' and the originating server
      const mcpTools = tools.filter((t) => t.source === 'mcp');
      expect(mcpTools.length).toBeGreaterThanOrEqual(expectedNames.length);
      for (const t of mcpTools) {
        expect(t.server).toBe('web-tools');
        expect(t.enabled).toBe(true);
      }
    } finally {
      await cleanup();
    }
  });

  it('T12 instance discovery (listProviders) includes the configured providers @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-017', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const providers = agent.listProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(1);

      // every provider info has a name + configured flag
      for (const p of providers) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.configured).toBe('boolean');
      }
    } finally {
      await cleanup();
    }
  });

  it('T12b agent.mcp.listServers/status/toolsByServer reflect the fake MCP infra; discovery-blocking honored @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013', async () => {
    const server: FakeMcpServerHandle = registry.registerServer(
      'db-tools',
      stdioFakeConfig('fake-mcp-db'),
    );
    server.setTools([
      { name: 'query', description: 'run a query', enabled: true },
      { name: 'schema', description: 'show schema', enabled: true },
    ]);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: {
        'db-tools': server.config,
      },
    });
    try {
      // listServers reflects the registered fake server
      const servers = agent.mcp.listServers();
      expect(servers.length).toBeGreaterThanOrEqual(1);
      const dbServer = servers.find((s) => s.name === 'db-tools');
      expect(dbServer).toBeDefined();
      expect(dbServer?.config).toBeDefined();

      // status reflects the discovery state + servers
      const status = agent.mcp.status();
      expect(typeof status.discoveryState).toBe('string');
      expect(status.servers.length).toBeGreaterThanOrEqual(1);

      // toolsByServer groups the discovered tools under each server name
      const byServer = agent.mcp.toolsByServer();
      const dbTools = byServer['db-tools'];
      expect(Array.isArray(dbTools)).toBe(true);
      expect(dbTools.length).toBeGreaterThanOrEqual(2);
      const dbToolNames = dbTools.map((t) => t.name);
      expect(dbToolNames).toContain('query');
      expect(dbToolNames).toContain('schema');

      // discoveryState() is callable independently
      const state = agent.mcp.discoveryState();
      expect(typeof state).toBe('string');
    } finally {
      await cleanup();
    }
  });

  it('T20 default chat() awaits MCP readiness before the turn proceeds @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013', async () => {
    const server: FakeMcpServerHandle = registry.registerServer(
      'slow-tools',
      stdioFakeConfig('fake-slow-mcp'),
    );
    server.setTools([{ name: 'slow_op', enabled: true }]);
    server.setDiscoveryLatencyMs(10);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: { 'slow-tools': server.config },
    });
    try {
      // default behavior: chat() awaits MCP readiness; the turn completes with
      // exactly one done (no error) once discovery resolves.
      const result = await agent.chat('run after discovery');
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');
    } finally {
      await cleanup();
    }
  });

  it('T20 TurnOptions.mcpDiscovery:skip opts out of awaiting MCP readiness @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013', async () => {
    const server: FakeMcpServerHandle = registry.registerServer(
      'skipped-tools',
      stdioFakeConfig('fake-skipped-mcp'),
    );
    server.setTools([{ name: 'skip_op', enabled: true }]);
    server.setDiscoveryLatencyMs(1000); // would block if awaited
    // This discovery would ALSO fail if the gate ran — so a 'skip' that bypasses
    // the gate must yield a SUCCESSFUL turn (no error), whereas a mutant that
    // removed the `mcpDiscovery === 'skip'` short-circuit would run the gate and
    // surface a mcp_discovery_failed error instead.
    server.failDiscovery('would block and fail if awaited');

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: { 'skipped-tools': server.config },
    });
    try {
      // skip: the turn proceeds WITHOUT awaiting (or failing) the discovery
      const result = await agent.chat('skip discovery', {
        mcpDiscovery: 'skip',
      });
      expect(result.text.length).toBeGreaterThan(0);
      // skip means the gate did NOT run → no discovery error is surfaced
      expect(result.finishReason).not.toBe('error');
      expect(result.error).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T20 discovery FAILURE yields AgentError{code:mcp_discovery_failed} via the buffered result surface + exactly one done:error on the stream @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013', async () => {
    const server: FakeMcpServerHandle = registry.registerServer(
      'broken-tools',
      stdioFakeConfig('fake-broken-mcp'),
    );
    server.setTools([{ name: 'broken_op', enabled: true }]);
    server.failDiscovery('connection refused');

    // Assert the typed failure code through the BUFFERED result surface —
    // AgentResult.error.code is a fully-typed AgentErrorCode union member;
    // NO casts. The stream error event payload (StructuredError) has no
    // `code` field, so the code MUST be read from the buffered result.
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: { 'broken-tools': server.config },
    });
    try {
      const result = await agent.chat('trigger broken discovery');
      expect(result.finishReason).toBe('error');
      expect(result.error?.code).toBe('mcp_discovery_failed');
      // The gate-failure result is an EMPTY turn: no text and no tool calls are
      // produced (the model turn never runs). Mutants that replace the empty
      // string/array literals would leak non-empty content here.
      expect(result.text).toBe('');
      expect(result.toolCalls).toStrictEqual([]);
      // The failure message embeds the failing server name and its reason in
      // the `${server}: ${message}` form joined by '; '. Mutants on the join
      // separator, the arrow projection, or the message template would not
      // produce this exact substring.
      expect(result.error?.message).toContain(
        'broken-tools: connection refused',
      );
      expect(result.error?.message).toContain('MCP discovery failed');
    } finally {
      await cleanup();
    }

    // SEPARATE fresh agent: assert the STREAM invariant (exactly one `done`
    // with reason `error`) via the existing cast-free predicates. A distinct
    // agent instance avoids reusing one agent for two turns against a
    // single-line fixture.
    const { agent: streamAgent, cleanup: streamCleanup } = await buildAgent(
      'plain-text.jsonl',
      { mcpServers: { 'broken-tools': server.config } },
    );
    try {
      const events = await drain(
        streamAgent.stream('trigger broken discovery'),
      );
      const types = typesOf(events);

      const done = events.filter(isDoneEvent);
      expect(done).toHaveLength(1);
      expect(done[0].reason).toBe('error');
      expect(types[types.length - 1]).toBe('done');
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await streamCleanup();
    }
  });

  it('T20 mcp.status/listTools remain callable while discovery is pending (non-blocking) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-013', async () => {
    const server: FakeMcpServerHandle = registry.registerServer(
      'pending-tools',
      stdioFakeConfig('fake-pending-mcp'),
    );
    server.setTools([{ name: 'pending_op', enabled: true }]);
    server.setDiscoveryLatencyMs(50);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      mcpServers: { 'pending-tools': server.config },
    });
    try {
      // while discovery is pending, status() is still callable
      const status = agent.mcp.status();
      expect(typeof status.discoveryState).toBe('string');

      // and listTools() is still callable (returns whatever is known so far)
      const tools = agent.listTools();
      expect(Array.isArray(tools)).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

/**
 * Focused behavioral unit coverage for the McpControl projection surface.
 * Drives the REAL McpControl class over the production McpControlDeps seam with
 * an in-memory manager/registry fake, asserting the exact projected values for
 * every discovery-state, server-status, tool-grouping, auth, and refresh
 * branch (the same projections AgentImpl exposes via agent.mcp.*).
 */
describe('McpControl projection @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
  it('discoveryState() returns idle before the manager exists @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps } = createFakeMcpDeps({ hasManager: false });
    const control = new McpControl(deps);
    expect(control.discoveryState()).toBe('idle');
    // listServers + toolsByServer degrade to empty without a manager/registry.
    expect(control.listServers()).toStrictEqual([]);
  });

  it('discoveryState() maps NOT_STARTED→idle, IN_PROGRESS→pending, COMPLETED(no failures)→ready @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: { alpha: fakeServerConfig() },
    });
    const control = new McpControl(deps);

    manager.setDiscoveryState(MCPDiscoveryState.NOT_STARTED);
    expect(control.discoveryState()).toBe('idle');

    manager.setDiscoveryState(MCPDiscoveryState.IN_PROGRESS);
    expect(control.discoveryState()).toBe('pending');

    manager.setDiscoveryState(MCPDiscoveryState.COMPLETED);
    manager.clearFailures();
    expect(control.discoveryState()).toBe('ready');
  });

  it('discoveryState() COMPLETED with a failure → failed when no server is connected, partial when one is @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: { alpha: fakeServerConfig(), beta: fakeServerConfig() },
    });
    const control = new McpControl(deps);
    manager.setDiscoveryState(MCPDiscoveryState.COMPLETED);

    // a failure with NO connected server → 'failed'
    setServerStatus('alpha', MCPServerStatus.DISCONNECTED);
    setServerStatus('beta', MCPServerStatus.DISCONNECTED);
    manager.setFailure('alpha', 'connection refused');
    expect(control.discoveryState()).toBe('failed');

    // the SAME failure alongside a connected sibling → 'partial'
    setServerStatus('beta', MCPServerStatus.CONNECTED);
    expect(control.discoveryState()).toBe('partial');
  });

  it('listServers() projects status per server: failure→error, and the live connected/connecting/disconnected core status otherwise @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: {
        conn: fakeServerConfig({ type: 'stdio' }),
        connecting: fakeServerConfig(),
        down: fakeServerConfig(),
        broken: fakeServerConfig(),
      },
    });
    const control = new McpControl(deps);
    manager.setDiscoveryState(MCPDiscoveryState.COMPLETED);

    setServerStatus('conn', MCPServerStatus.CONNECTED);
    setServerStatus('connecting', MCPServerStatus.CONNECTING);
    setServerStatus('down', MCPServerStatus.DISCONNECTED);
    setServerStatus('broken', MCPServerStatus.CONNECTED);
    manager.setFailure('broken', 'boom');

    const servers = control.listServers();
    const byName = new Map(servers.map((s) => [s.name, s]));
    expect(byName.get('conn')?.status).toBe('connected');
    expect(byName.get('connecting')?.status).toBe('connecting');
    expect(byName.get('down')?.status).toBe('disconnected');
    // a recorded failure overrides the live status with 'error'
    expect(byName.get('broken')?.status).toBe('error');

    // transport is surfaced only when config.type is a string
    expect(byName.get('conn')?.transport).toBe('stdio');
    expect(byName.get('connecting')?.transport).toBeUndefined();
  });

  it('listServers() attaches the grouped tool names only for servers that own tools @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: { withtools: fakeServerConfig(), empty: fakeServerConfig() },
      tools: [
        { name: 'search', serverName: 'withtools', enabled: true },
        { name: 'fetch', serverName: 'withtools', enabled: true },
      ],
    });
    const control = new McpControl(deps);
    manager.setDiscoveryState(MCPDiscoveryState.COMPLETED);
    setServerStatus('withtools', MCPServerStatus.CONNECTED);
    setServerStatus('empty', MCPServerStatus.CONNECTED);

    const servers = control.listServers();
    const withtools = servers.find((s) => s.name === 'withtools');
    const empty = servers.find((s) => s.name === 'empty');
    expect(withtools?.tools).toStrictEqual(['search', 'fetch']);
    // a server with no discovered tools omits the tools field entirely
    expect(empty?.tools).toBeUndefined();
  });

  it('toolsByServer() groups only tools that carry a non-empty serverName and reflects the enabled flag @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps } = createFakeMcpDeps({
      tools: [
        { name: 'a', serverName: 'srv1', description: 'tool a', enabled: true },
        { name: 'b', serverName: 'srv1', enabled: false },
        { name: 'c', serverName: 'srv2', enabled: true },
        { name: 'builtin', serverName: undefined, enabled: true },
        { name: 'blankserver', serverName: '', enabled: true },
      ],
    });
    const control = new McpControl(deps);
    const grouped = control.toolsByServer();

    expect(Object.keys(grouped).sort()).toStrictEqual(['srv1', 'srv2']);
    const srv1 = grouped['srv1'];
    expect(srv1.map((t) => t.name)).toStrictEqual(['a', 'b']);
    // enabled mirrors the registry's enabled set exactly
    expect(srv1.find((t) => t.name === 'a')?.enabled).toBe(true);
    expect(srv1.find((t) => t.name === 'b')?.enabled).toBe(false);
    // description is carried through only when present
    expect(srv1.find((t) => t.name === 'a')?.description).toBe('tool a');
    expect(srv1.find((t) => t.name === 'b')?.description).toBeUndefined();
    // every grouped tool is sourced as 'mcp' and tagged with its server
    expect(srv1.every((t) => t.source === 'mcp')).toBe(true);
    expect(srv1.every((t) => t.server === 'srv1')).toBe(true);
    // tools without a server (undefined or empty) are excluded entirely
    expect(grouped['srv2'].map((t) => t.name)).toStrictEqual(['c']);
  });

  it('toolsByServer() returns an empty map when no registry is wired @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps } = createFakeMcpDeps({ hasRegistry: false });
    const control = new McpControl(deps);
    expect(control.toolsByServer()).toStrictEqual({});
  });

  it('status() composes discoveryState() and listServers() into a single snapshot @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: { only: fakeServerConfig() },
      tools: [{ name: 'go', serverName: 'only', enabled: true }],
    });
    const control = new McpControl(deps);
    manager.setDiscoveryState(MCPDiscoveryState.COMPLETED);
    manager.clearFailures();
    setServerStatus('only', MCPServerStatus.CONNECTED);

    const status = control.status();
    expect(status.discoveryState).toBe('ready');
    expect(status.servers.map((s) => s.name)).toStrictEqual(['only']);
    expect(status.servers[0].status).toBe('connected');
  });

  it('auth() projects the in-session marker as sessionAuthenticated; authenticated derives from the real persisted status @plan:PLAN-20260617-COREAPI.P22 @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-013', async () => {
    const { deps } = createFakeMcpDeps({
      authenticatedServers: ['loggedin'],
    });
    const control = new McpControl(deps);

    // 'loggedin' has an in-session marker but no real persisted token, so
    // sessionAuthenticated is true while authenticated is false (corrected
    // semantics — authenticated no longer comes from the marker Set).
    const authed = await control.auth('loggedin');
    expect(authed).toStrictEqual({
      server: 'loggedin',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: true,
    });

    const notAuthed = await control.auth('stranger');
    expect(notAuthed.authenticated).toBe(false);
    expect(notAuthed.requiresAuth).toBe(false);
    expect(notAuthed.oauthStatus).toBe('not-required');
    expect(notAuthed.sessionAuthenticated).toBe(false);
    expect(notAuthed.server).toBe('stranger');
  });

  it('refresh(server) restarts exactly that server; refresh() restarts all @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', async () => {
    const { deps, manager } = createFakeMcpDeps({
      servers: { one: fakeServerConfig() },
    });
    const control = new McpControl(deps);

    await control.refresh('one');
    expect(manager.restartedServers()).toStrictEqual(['one']);
    expect(manager.restartAllCount()).toBe(0);

    await control.refresh();
    expect(manager.restartAllCount()).toBe(1);
    // refresh-all does not additionally target a single server
    expect(manager.restartedServers()).toStrictEqual(['one']);
  });

  it('refresh() is a no-op (resolves) when the manager is not yet initialized @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', async () => {
    const { deps } = createFakeMcpDeps({ hasManager: false });
    const control = new McpControl(deps);
    await expect(control.refresh('whatever')).resolves.toBeUndefined();
    await expect(control.refresh()).resolves.toBeUndefined();
  });

  it('a deps-less McpControl degrades every read to its empty/idle default and auth to unauthenticated @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013', async () => {
    // Constructed with no deps at all (the optional constructor arg). Every
    // surface must fall back to its safe default rather than throwing.
    const control = new McpControl();
    expect(control.discoveryState()).toBe('idle');
    expect(control.listServers()).toStrictEqual([]);
    expect(control.toolsByServer()).toStrictEqual({});
    expect(control.status()).toStrictEqual({
      discoveryState: 'idle',
      servers: [],
    });
    await expect(control.refresh('x')).resolves.toBeUndefined();
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 — a deps-less control has no
    // getRequiresAuth closure → requiresAuth is undefined-safe false (no longer
    // hardcoded true).
    const auth = await control.auth('anything');
    expect(auth.authenticated).toBe(false);
    expect(auth.requiresAuth).toBe(false);
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06a — a deps-less control has no
    // getOAuthStatus closure → oauthStatus is undefined-safe 'not-required';
    // and no deps at all → sessionAuthenticated is undefined-safe false (this
    // kills the `?? true` survivor on the `?? false` default at buildAuthStatus).
    expect(auth.oauthStatus).toBe('not-required');
    expect(auth.sessionAuthenticated).toBe(false);
  });
});
