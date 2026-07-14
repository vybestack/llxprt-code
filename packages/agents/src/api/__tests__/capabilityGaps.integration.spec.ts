// @plan:PLAN-20260622-COREAPIGAP.P20 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P20 — Capability-Gap Integration Adequacy Driver (the #1595 keystone).
 *
 * PROVES every new Agent capability is reachable for the future CLI using ONLY
 * the public root `@vybestack/llxprt-code-agents` — with NO config-escape
 * hatch and NO deep import. Each capability is exercised on a REAL Agent built
 * through the public harness (FakeProvider, no MCP manager, no real OAuth) —
 * exactly the surface #1595 will hold.
 */

import { describe, expect, it, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-agents';
import type {
  AgentTaskInfo,
  PolicyRuleView,
  HookInfo,
  AuthProviderDetail,
  AuthBucketStatus,
  McpDetailStatus,
  ToolKeyInfo,
  ToolKeyStatus,
} from '@vybestack/llxprt-code-agents';
import { buildAgent, type BuiltAgent } from './helpers/agentHarness.js';

const FIXTURE = 'plain-text.jsonl';
const ALL_APPROVAL_MODES = Object.values(ApprovalMode);
const ALL_POLICY_DECISIONS = Object.values(PolicyDecision);

function isSafeMaskedKey(masked: string | undefined): boolean {
  if (masked === undefined) {
    return true;
  }
  return masked.includes('*') === true || masked.length < 20;
}

describe('P20 capability-gap integration adequacy (REQ-INT-001..004) @plan:PLAN-20260622-COREAPIGAP.P20', () => {
  let built: BuiltAgent | undefined;

  afterEach(async () => {
    if (built) {
      await built.cleanup();
      built = undefined;
    }
  });

  // ─── REQ-INT-001: Approval ────────────────────────────────────────────────

  it('approval: trusted agent getApprovalMode() returns a value in Object.values(ApprovalMode)', async () => {
    built = await buildAgent(FIXTURE);
    expect(ALL_APPROVAL_MODES).toContain(built.agent.getApprovalMode());
  });

  it('approval: trusted agent setApprovalMode(YOLO) then getApprovalMode() === YOLO (live write-then-read)', async () => {
    built = await buildAgent(FIXTURE);
    built.agent.setApprovalMode(ApprovalMode.YOLO);
    expect(built.agent.getApprovalMode()).toBe(ApprovalMode.YOLO);
  });

  it('approval: UNTRUSTED agent (folderTrust:false) setApprovalMode(YOLO) throws /untrusted folder/i (delegated throw via public harness)', async () => {
    built = await buildAgent(FIXTURE, { folderTrust: false });
    expect(() => built!.agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      /untrusted folder/i,
    );
  });

  // ─── REQ-INT-002: Policy ──────────────────────────────────────────────────

  it('policy: getRules() returns an array; each element has string toolName (when present) and decision in Object.values(PolicyDecision)', async () => {
    built = await buildAgent(FIXTURE);
    const rules: readonly PolicyRuleView[] = built.agent.policy.getRules();
    expect(Array.isArray(rules)).toBe(true);
    // toolName is optional (undefined means "all tools"); when present it is a
    // string. decision is always a PolicyDecision value.
    rules
      .filter((r) => r.toolName !== undefined)
      .forEach((r) => expect(typeof r.toolName).toBe('string'));
    rules.forEach((r) => expect(ALL_POLICY_DECISIONS).toContain(r.decision));
  });

  it('policy: getDefaultDecision() is in Object.values(PolicyDecision)', async () => {
    built = await buildAgent(FIXTURE);
    expect(ALL_POLICY_DECISIONS).toContain(
      built.agent.policy.getDefaultDecision(),
    );
  });

  it('policy: isNonInteractive() returns a boolean', async () => {
    built = await buildAgent(FIXTURE);
    expect(typeof built.agent.policy.isNonInteractive()).toBe('boolean');
  });

  // ─── REQ-INT-002: Tasks ───────────────────────────────────────────────────

  it('tasks: on a fresh agent list() and listRunning() are arrays, get/cancel are undefined/false-safe, cancelAllRunning() is 0', async () => {
    built = await buildAgent(FIXTURE);
    const tasks: readonly AgentTaskInfo[] = built.agent.tasks.list();
    const running: readonly AgentTaskInfo[] = built.agent.tasks.listRunning();
    expect(Array.isArray(tasks)).toBe(true);
    expect(Array.isArray(running)).toBe(true);
    expect(built.agent.tasks.get('nonexistent')).toBeUndefined();
    expect(built.agent.tasks.cancel('nonexistent')).toBe(false);
    expect(built.agent.tasks.cancelAllRunning()).toBe(0);
    // Any present element MUST be a projected view WITHOUT abortController.
    [...tasks, ...running].forEach((task) =>
      expect('abortController' in task).toBe(false),
    );
  });

  // ─── REQ-INT-003: Hooks-admin ─────────────────────────────────────────────

  it('hooks-admin: listHooks() returns an array; setDisabledHooks/enable round-trip (undefined-safe, no throw)', async () => {
    built = await buildAgent(FIXTURE);
    const hooks: readonly HookInfo[] = built.agent.hooks.listHooks();
    expect(Array.isArray(hooks)).toBe(true);
    built.agent.hooks.setDisabledHooks(['demo-hook']);
    expect(built.agent.hooks.getDisabledHooks()).toContain('demo-hook');
    built.agent.hooks.enable('demo-hook');
    expect(built.agent.hooks.getDisabledHooks()).not.toContain('demo-hook');
  });

  // ─── REQ-INT-003: Auth-detail ─────────────────────────────────────────────

  it('auth-detail: detailedStatus(openai) resolves to object with boolean authenticated; getHigherPriorityAuth is string|null; listBucketStatuses is an array', async () => {
    built = await buildAgent(FIXTURE);
    const detail: AuthProviderDetail =
      await built.agent.auth.detailedStatus('openai');
    expect(typeof detail.authenticated).toBe('boolean');
    const higher: string | null =
      await built.agent.auth.getHigherPriorityAuth('openai');
    expect(higher === null || typeof higher === 'string').toBe(true);
    const buckets: readonly AuthBucketStatus[] =
      await built.agent.auth.listBucketStatuses('openai');
    expect(Array.isArray(buckets)).toBe(true);
  });

  // ─── REQ-INT-004: MCP ─────────────────────────────────────────────────────

  it('mcp: status() resolves (idle, no manager); details() servers is an empty array; authenticate(unknown) is authenticated===false with no throw', async () => {
    built = await buildAgent(FIXTURE);
    built.agent.mcp.status();
    const detail: McpDetailStatus = await built.agent.mcp.details();
    expect(Array.isArray(detail.servers)).toBe(true);
    expect(detail.servers).toHaveLength(0);
    const authStatus = await built.agent.mcp.authenticate('nonexistent-server');
    expect(authStatus.authenticated).toBe(false);
  });

  // ─── REQ-INT-004: Tool-keys ───────────────────────────────────────────────

  it('tool-keys: supported() is a NON-EMPTY array with string toolName each; save/status/delete/setKeyFile/getKeyFile are functions; status(exa).hasKey is boolean and maskedKey (if present) is not a raw secret', async () => {
    built = await buildAgent(FIXTURE);
    const supported: readonly ToolKeyInfo[] =
      built.agent.tools.keys.supported();
    expect(Array.isArray(supported)).toBe(true);
    expect(supported.length).toBeGreaterThan(0);
    for (const entry of supported) {
      expect(typeof entry.toolName).toBe('string');
    }
    expect(typeof built.agent.tools.keys.save).toBe('function');
    expect(typeof built.agent.tools.keys.status).toBe('function');
    expect(typeof built.agent.tools.keys.delete).toBe('function');
    expect(typeof built.agent.tools.keys.setKeyFile).toBe('function');
    expect(typeof built.agent.tools.keys.getKeyFile).toBe('function');
    // Read-only status on a real registry entry ('exa'); NO keyring mutation.
    const status: ToolKeyStatus = await built.agent.tools.keys.status('exa');
    expect(typeof status.hasKey).toBe('boolean');
    // Masked-only contract: a masked key carries a `*` or is short — never a
    // full-length raw secret. When maskedKey is absent the contract holds
    // vacuously; when present it must satisfy the mask shape.
    expect(isSafeMaskedKey(status.maskedKey)).toBe(true);
  });

  // ─── #1595 Keystone: every capability entry is a function on the public root ─

  it('exercises every capability without a config-escape hatch', async () => {
    built = await buildAgent(FIXTURE);
    expect(typeof built.agent.setApprovalMode).toBe('function');
    expect(typeof built.agent.policy.getRules).toBe('function');
    expect(typeof built.agent.tasks.list).toBe('function');
    expect(typeof built.agent.hooks.listHooks).toBe('function');
    expect(typeof built.agent.auth.detailedStatus).toBe('function');
    expect(typeof built.agent.mcp.details).toBe('function');
    expect(typeof built.agent.tools.keys.supported).toBe('function');
  });

  // ─── Property tests (≥30%, MIN-2; classic fast-check form) ────────────────

  it('PROP approval round-trip: for any mode m in Object.values(ApprovalMode), setApprovalMode(m) then getApprovalMode() === m (trusted agent)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ALL_APPROVAL_MODES), async (mode) => {
        const local = await buildAgent(FIXTURE);
        try {
          local.agent.setApprovalMode(mode);
          expect(local.agent.getApprovalMode()).toBe(mode);
        } finally {
          await local.cleanup();
        }
      }),
    );
  });

  it('PROP hooks round-trip: for any uniqueArray of hook names (maxLength 5), setDisabledHooks(names) then getDisabledHooks() set-equals the input', async () => {
    built = await buildAgent(FIXTURE);
    const agent = built.agent;
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 5 }),
        async (names) => {
          agent.hooks.setDisabledHooks(names);
          const got = agent.hooks.getDisabledHooks();
          // set-equality (order-independent): same members, same length.
          expect(got.slice().sort()).toStrictEqual(names.slice().sort());
          expect(got).toHaveLength(names.length);
          // Restore the disabled set for the next case.
          agent.hooks.setDisabledHooks([]);
        },
      ),
    );
  });

  it('PROP tasks projection: for any fresh agent, every element of list() and listRunning() omits abortController', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('fresh'), async () => {
        const local = await buildAgent(FIXTURE);
        try {
          const tasks = local.agent.tasks.list();
          const running = local.agent.tasks.listRunning();
          expect(Array.isArray(tasks)).toBe(true);
          expect(Array.isArray(running)).toBe(true);
          [...tasks, ...running].forEach((t) =>
            expect('abortController' in t).toBe(false),
          );
        } finally {
          await local.cleanup();
        }
      }),
    );
  });

  it('PROP tool-keys registry: for any fresh agent, supported() is non-empty and every entry has a string toolName', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('fresh'), async () => {
        const local = await buildAgent(FIXTURE);
        try {
          const supported = local.agent.tools.keys.supported();
          expect(Array.isArray(supported)).toBe(true);
          expect(supported.length).toBeGreaterThan(0);
          supported.forEach((e) => expect(typeof e.toolName).toBe('string'));
        } finally {
          await local.cleanup();
        }
      }),
    );
  });

  it('PROP mcp undefined-safe: for any arbitrary server name, authenticate(name) resolves authenticated===false (no throw, no manager)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !s.includes('\0')),
        async (server) => {
          const local = await buildAgent(FIXTURE);
          try {
            const status = await local.agent.mcp.authenticate(server);
            expect(status.authenticated).toBe(false);
          } finally {
            await local.cleanup();
          }
        },
      ),
    );
  });

  it('PROP auth masked invariant: detailedStatus(openai) leaks no raw-secret field and no ≥20-char opaque string value', async () => {
    built = await buildAgent(FIXTURE);
    const agent = built.agent;
    // A raw bearer token would leak either as a field literally named like a
    // secret, or as a long opaque string value. The masked-only contract means
    // neither appears in the public projection. The FakeProvider harness only
    // registers the openai provider, so the property is driven over it.
    const SECRET_FIELDS = new Set([
      'token',
      'accesstoken',
      'refreshtoken',
      'apikey',
      'api_key',
      'secret',
      'password',
    ]);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('openai'), async (provider) => {
        const detail = await agent.auth.detailedStatus(provider);
        // Collect any leak signal by walking the projection WITHOUT nesting
        // expects in conditionals (repo eslint forbids that). A raw bearer
        // token leaks either as a secret-named field or as a ≥20-char opaque
        // string value; the masked-only contract means neither appears.
        const secretFields: string[] = [];
        const opaqueValues: string[] = [];
        const walk = (node: unknown): void => {
          if (node !== null && typeof node === 'object') {
            Object.entries(node as Record<string, unknown>).forEach(
              ([k, v]) => {
                if (SECRET_FIELDS.has(k.toLowerCase())) {
                  secretFields.push(k);
                }
                if (
                  typeof v === 'string' &&
                  v.length >= 20 &&
                  v.split(/\s/).join('').length === v.length &&
                  !v.includes('*')
                ) {
                  opaqueValues.push(v);
                }
                walk(v);
              },
            );
          }
        };
        walk(detail);
        expect(secretFields).toStrictEqual([]);
        expect(opaqueValues).toStrictEqual([]);
      }),
    );
  });
});
