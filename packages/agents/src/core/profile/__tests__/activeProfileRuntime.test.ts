/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type {
  ProfileState,
  ProfileRuntimeBinding,
  EffectiveToolPolicy,
  PolicyCeiling,
} from '@vybestack/llxprt-code-core';
import {
  ActiveProfileRuntime,
  ProfileRuntimeDisposedError,
} from '../activeProfileRuntime.js';
import {
  configuredState as requireConfigured,
  type ConfiguredProfileState,
} from './controllerTestFakes.js';

const permissivePolicy: EffectiveToolPolicy = {
  allowedTools: [],
  disabledTools: [],
  shellMode: 'all',
  approvalCeiling: 'yolo',
};

const configuredState = (): ConfiguredProfileState => ({
  status: 'configured',
  revision: 3,
  identity: {
    kind: 'saved',
    name: 'work',
    source: { kind: 'stat', mtimeMs: 1234, size: 512 },
  },
  document: {
    version: 1,
    type: 'standard',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    modelParams: { temperature: 0.2 },
    ephemeralSettings: {},
  },
});

/**
 * Controllable fake binding whose dispose never settles until released.
 */
function deferredBinding(): {
  binding: ProfileRuntimeBinding;
  release: () => void;
  disposeCount: () => number;
} {
  let disposeCalls = 0;
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const binding: ProfileRuntimeBinding = {
    bindingId: 'binding-fake-1',
    configFingerprint: 'fp-1',
    [Symbol.asyncDispose]: (): Promise<void> => {
      disposeCalls += 1;
      return promise;
    },
  };
  return {
    binding,
    release,
    disposeCount: () => disposeCalls,
  };
}

describe('ActiveProfileRuntime', () => {
  it('exposes the construction state and a healthy default', () => {
    const runtime = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    expect(runtime.getState()).toStrictEqual(configuredState());
    expect(runtime.getHealth()).toStrictEqual({
      status: 'ok',
      degradedAspects: [],
    });
  });

  describe('ActiveProfileRuntime policy and role views', () => {
    const declarations = [
      { name: 'read', description: 'Read a file' },
      { name: 'edit', description: 'Edit a file' },
      { name: 'shell', description: 'Run a command' },
    ];

    it('filters from an immutable construction policy without changing declarations', () => {
      const policy: EffectiveToolPolicy = {
        allowedTools: ['read', 'edit'],
        disabledTools: ['edit'],
        shellMode: 'allowlist',
        approvalCeiling: 'standard',
      };
      const runtime = new ActiveProfileRuntime(configuredState, 5000, policy);
      policy.allowedTools = ['shell'];
      policy.disabledTools = [];
      const filtered = runtime.getFilteredToolDeclarations(declarations);
      expect(filtered).toStrictEqual([declarations[0]]);
      expect(Object.isFrozen(filtered)).toStrictEqual(true);
      expect(Object.isFrozen(filtered[0])).toStrictEqual(true);
      expect(Object.isFrozen(declarations[0])).toStrictEqual(false);
      expect(Object.isFrozen(runtime.getPolicy())).toStrictEqual(true);
      expect(Object.isFrozen(runtime.getPolicy().allowedTools)).toStrictEqual(
        true,
      );
    });

    it('keeps all declarations with an unrestricted allowlist, except disabled tools', () => {
      const runtime = new ActiveProfileRuntime(
        configuredState,
        undefined,
        permissivePolicy,
      );
      expect(runtime.getFilteredToolDeclarations(declarations)).toStrictEqual(
        declarations,
      );
      const restricted = new ActiveProfileRuntime(configuredState, 5000, {
        ...runtime.getPolicy(),
        disabledTools: ['shell'],
      });
      expect(
        restricted.getFilteredToolDeclarations(declarations),
      ).toStrictEqual(declarations.slice(0, 2));
    });

    it('captures the role document and parent revision while sharing the binding', async () => {
      const parent = new ActiveProfileRuntime(configuredState, 5000, {
        allowedTools: ['read', 'edit'],
        disabledTools: ['shell'],
        shellMode: 'allowlist',
        approvalCeiling: 'standard',
      });
      const fake = deferredBinding();
      parent.attach(fake.binding);
      const document = {
        ...configuredState().document,
        modelParams: { temperature: 0.2 },
      };
      const captured = structuredClone(document);
      const rolePolicy: PolicyCeiling = {
        allowedTools: ['read'],
        approvalCeiling: 'strict',
      };
      expect(parent.snapshot().roleRuntimeCount).toStrictEqual(0);
      const child = parent.createRoleRuntime(
        { name: 'reviewer', document },
        rolePolicy,
      );
      document.model = 'changed';
      document.modelParams['temperature'] = 0.9;
      rolePolicy.allowedTools = ['shell'];
      parent.resupplyState(() => ({ ...configuredState(), revision: 4 }));
      expect(requireConfigured(child.getState()).document).toStrictEqual(
        captured,
      );
      expect(child.snapshot().revision).toStrictEqual(3);
      expect(
        Object.isFrozen(
          requireConfigured(child.getState()).document.modelParams,
        ),
      ).toStrictEqual(true);
      expect(child.getBindingId()).toStrictEqual(parent.getBindingId());
      expect(child.getPolicy()).toStrictEqual({
        allowedTools: ['read'],
        disabledTools: ['shell'],
        shellMode: 'allowlist',
        approvalCeiling: 'strict',
      });
      expect(child.getFilteredToolDeclarations(declarations)).toStrictEqual([
        declarations[0],
      ]);
      expect(parent.snapshot().roleRuntimeCount).toStrictEqual(1);
      expect(JSON.stringify(parent.snapshot())).not.toContain('reviewer');
      await child[Symbol.asyncDispose]();
      expect(fake.disposeCount()).toStrictEqual(0);
      fake.release();
      await parent[Symbol.asyncDispose]();
      await child[Symbol.asyncDispose]();
      expect(fake.disposeCount()).toStrictEqual(1);
    });

    it('does not widen tools for disjoint role allowlists or omitted ceilings', () => {
      const parent = new ActiveProfileRuntime(configuredState, 5000, {
        allowedTools: ['read'],
        disabledTools: [],
        shellMode: 'none',
        approvalCeiling: 'strict',
      });
      const roleRef = { name: 'role', document: configuredState().document };
      const unrestricted = parent.createRoleRuntime(roleRef);
      expect(unrestricted.getPolicy()).toStrictEqual(parent.getPolicy());
      const disjoint = parent.createRoleRuntime(roleRef, {
        allowedTools: ['edit'],
      });
      expect(disjoint.getFilteredToolDeclarations(declarations)).toStrictEqual(
        [],
      );
      const descendant = disjoint.createRoleRuntime(roleRef);
      expect(
        descendant.getFilteredToolDeclarations(declarations),
      ).toStrictEqual([]);
    });

    it('narrows an unrestricted parent to the role allowlist', () => {
      const parent = new ActiveProfileRuntime(
        configuredState,
        undefined,
        permissivePolicy,
      );
      const child = parent.createRoleRuntime(
        { name: 'reader', document: configuredState().document },
        { allowedTools: ['read'] },
      );
      expect(child.getPolicy().allowedTools).toStrictEqual(['read']);
      expect(child.getFilteredToolDeclarations(declarations)).toStrictEqual([
        declarations[0],
      ]);
    });
  });

  it('snapshot follows a re-supplied state and keeps health untouched', () => {
    const savedState = (): ConfiguredProfileState => ({
      status: 'configured',
      revision: 1,
      identity: {
        kind: 'saved',
        name: 'work',
        source: { kind: 'stat', mtimeMs: 7, size: 9 },
      },
      document: {
        version: 1,
        type: 'standard',
        provider: 'prov-a',
        model: 'm1',
        modelParams: {},
        ephemeralSettings: {},
      },
    });
    let current = savedState();
    const runtime = new ActiveProfileRuntime(
      () => current,
      undefined,
      permissivePolicy,
    );
    runtime.attach(deferredBinding().binding);
    runtime.reportDegradation(['slow']);

    current = {
      ...savedState(),
      revision: 2,
      identity: {
        kind: 'draft',
        derivedFrom: {
          name: 'work',
          source: { kind: 'stat', mtimeMs: 7, size: 9 },
        },
      },
    };
    runtime.resupplyState(() => current);

    const snapshot = runtime.snapshot();
    expect(snapshot.revision).toBe(2);
    expect(snapshot.identity).toStrictEqual(current.identity);
    expect(snapshot.identityKind).toBe('draft');
    expect(runtime.getHealth()).toStrictEqual({
      status: 'degraded',
      degradedAspects: ['slow'],
    });
  });

  it('invalidates role operations on reattachment without widening binding ownership', async () => {
    const runtime = new ActiveProfileRuntime(
      configuredState,
      100,
      permissivePolicy,
    );
    const first = deferredBinding();
    const second = deferredBinding();
    runtime.attach(first.binding);
    const role = { name: 'reader', document: configuredState().document };
    const child = runtime.createRoleRuntime(role);
    const descendant = child.createRoleRuntime(role);
    runtime.attach(first.binding);
    expect(child.getBinding()).toStrictEqual(first.binding);
    runtime.attach(second.binding);
    const operations = [
      () => child.getState(),
      () => child.getPolicy(),
      () => child.getFilteredToolDeclarations([]),
      () => child.getHealth(),
      () => child.getBinding(),
      () => child.getBindingId(),
      () => child.snapshot(),
      () => child.attach(second.binding),
      () => child.createRoleRuntime(role),
      () => child.reportDegradation(['stale']),
      () => child.reportRecovery(['stale']),
      () => child.resupplyState(configuredState),
      () => child.releaseOwnership(),
      () => child.inheritHealthFrom(runtime),
      () => child.retainRoleRuntimesFrom(runtime),
      () => descendant.getBinding(),
    ];
    for (const operation of operations)
      expect(operation).toThrow(ProfileRuntimeDisposedError);
    await child[Symbol.asyncDispose]();
    expect(first.disposeCount()).toStrictEqual(0);
    const fresh = runtime.createRoleRuntime(role);
    expect(fresh.getBinding()).toStrictEqual(second.binding);
    const disposing = runtime[Symbol.asyncDispose]();
    expect(() => fresh.getBinding()).toThrow(ProfileRuntimeDisposedError);
    expect(second.disposeCount()).toStrictEqual(1);
    second.release();
    await disposing;
  });

  it('attach rebinds and keeps current health', () => {
    const runtime = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    const { binding } = deferredBinding();
    runtime.attach(binding);
    runtime.reportDegradation(['slow']);
    expect(runtime.getHealth().status).toBe('degraded');
    runtime.attach(binding);
    expect(runtime.getHealth()).toStrictEqual({
      status: 'degraded',
      degradedAspects: ['slow'],
    });
    expect(runtime.getBinding()).toBe(binding);
    expect(runtime.getBindingId()).toBe('binding-fake-1');
  });

  it('inheritHealthFrom carries a prior runtime health across a binding reuse', () => {
    const prior = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    const { binding } = deferredBinding();
    prior.attach(binding);
    prior.reportDegradation(['lb-member-down']);

    const next = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    next.attach(binding);
    expect(next.getHealth()).toStrictEqual({
      status: 'ok',
      degradedAspects: [],
    });
    next.inheritHealthFrom(prior);
    expect(next.getHealth()).toStrictEqual({
      status: 'degraded',
      degradedAspects: ['lb-member-down'],
    });
  });

  it('degradation does not change identity, revision, or document', () => {
    const runtime = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    const before = structuredClone(runtime.getState());
    runtime.attach(deferredBinding().binding);
    runtime.reportDegradation(['slow', 'stale']);
    expect(runtime.getState()).toStrictEqual(before);
    expect(runtime.getHealth().status).toBe('degraded');
    expect([...runtime.getHealth().degradedAspects].sort()).toStrictEqual([
      'slow',
      'stale',
    ]);
    const state = requireConfigured(runtime.getState());
    expect(state.revision).toBe(3);
    expect(state.identity.kind).toBe('saved');
    expect(state.document).toStrictEqual(configuredState().document);
  });

  it('recovery removes aspects and returns to ok when none remain', () => {
    const runtime = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    runtime.attach(deferredBinding().binding);
    runtime.reportDegradation(['a', 'b']);
    runtime.reportRecovery(['a']);
    expect(runtime.getHealth()).toStrictEqual({
      status: 'degraded',
      degradedAspects: ['b'],
    });
    runtime.reportRecovery(['b']);
    expect(runtime.getHealth()).toStrictEqual({
      status: 'ok',
      degradedAspects: [],
    });
  });

  it('asyncDispose disposes the binding exactly once even when it hangs', async () => {
    const fake = deferredBinding();
    const runtime = new ActiveProfileRuntime(
      configuredState,
      100,
      permissivePolicy,
    );
    runtime.attach(fake.binding);
    await runtime[Symbol.asyncDispose]();
    expect(fake.disposeCount()).toBe(1);
    expect(runtime.getHealth().status).toBe('degraded');
    fake.release();
  });

  it('asyncDispose swallows a failing dispose and records a degraded aspect', async () => {
    const failingBinding: ProfileRuntimeBinding = {
      bindingId: 'binding-fake-2',
      configFingerprint: 'fp-2',
      [Symbol.asyncDispose]: async () => {
        throw new Error('dispose boom');
      },
    };
    const runtime = new ActiveProfileRuntime(
      configuredState,
      undefined,
      permissivePolicy,
    );
    runtime.attach(failingBinding);
    await expect(runtime[Symbol.asyncDispose]()).resolves.toBeUndefined();
    expect(runtime.getHealth().status).toBe('degraded');
    expect(runtime.getHealth().degradedAspects[0]).toContain('dispose-failed');
  });

  it('snapshot exposes no secret keys', () => {
    const state: ProfileState = {
      status: 'configured',
      revision: 2,
      identity: {
        kind: 'draft',
        derivedFrom: {
          name: 'work',
          source: { kind: 'stat', mtimeMs: 1, size: 2 },
        },
      },
      document: {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'sk-super-secret',
          'auth-key-name': 'creds',
        },
      },
    };
    const runtime = new ActiveProfileRuntime(
      () => state,
      undefined,
      permissivePolicy,
    );
    const snapshot = runtime.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain('sk-super-secret');
    expect(JSON.stringify(snapshot)).not.toContain('auth-key');
  });
});
