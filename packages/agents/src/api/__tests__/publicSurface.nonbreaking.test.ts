/**
 * @plan:PLAN-20260621-COREAPIREMED.P21
 * @requirement:REQ-006
 *
 * Full non-breaking characterization of the agents public export surface.
 *
 * This is a characterization test: it ENUMERATES the actual current exports
 * (read dynamically from the built root barrel and the internals subpath) and
 * asserts every #1594-era symbol is still present with a compatible shape. It
 * is NOT a Path-A consumer and NOT a Path-B reference drive; it is one of the
 * TWO export-surface-introspection categories PERMITTED to import the internals
 * subpath, because asserting (REQ-006) that `./internals.js` STILL exports its
 * #1594-era value symbols (AgentClient, PostTurnAction) is ONLY provable by
 * importing that subpath at runtime.
 *
 * No mock theater: structural/identity assertions only. No deep /src/ imports.
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import * as root from '@vybestack/llxprt-code-agents';
import * as internals from '@vybestack/llxprt-code-agents/internals.js';
import type { Agent, AgentConfig } from '@vybestack/llxprt-code-agents';

// Type-level compile anchor: a signature change to createAgent would break
// typecheck. The shipped shape is `createAgent(AgentConfig): Promise<Agent>`.
const _createAgentShape: (cfg: AgentConfig) => Promise<Agent> =
  root.createAgent;

// Consume the binding so noUnusedLocals does not trip (it never runs at
// runtime; this is a compile-only guard).
void _createAgentShape;

describe('REQ-006 @plan:PLAN-20260621-COREAPIREMED.P21 — agents public export surface is non-breaking', () => {
  it('Test A: curated root barrel exposes every load-bearing #1594-era runtime value (superset)', () => {
    // Dynamic enumeration: read the actual keys the built barrel ships, then
    // assert the #1594-era load-bearing set is a SUBSET (the barrel may grow
    // additively but MUST never drop one of these).
    const rootKeys = new Set(Object.keys(root));
    const expectedRootFunctions: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'createTaskToolRegistration',
    ];
    for (const key of expectedRootFunctions) {
      expect(rootKeys.has(key), `root barrel must export "${key}"`).toBe(true);
      expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
    }

    // Classes are also `typeof 'function'` at runtime.
    const expectedRootClasses: readonly string[] = [
      'AdapterError',
      'AgenticLoop',
    ];
    for (const key of expectedRootClasses) {
      expect(rootKeys.has(key), `root barrel must export "${key}"`).toBe(true);
      expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('Test B: createAgent(AgentConfig) arity is 1 (single-arg signature unchanged)', () => {
    // The shipped signature is `createAgent(rawConfig: AgentConfig): Promise<Agent>`.
    // `.length` reflects the declared parameter count; an overload/extra param
    // would change it.
    expect(root.createAgent.length).toBe(1);
  });

  it('Test C: fromConfig is a SEPARATE export — not an overload that altered createAgent', () => {
    expect(typeof root.fromConfig).toBe('function');
    // Identity: fromConfig must NOT be the same binding as createAgent, proving
    // fromConfig did not mutate/replace createAgent's exported reference.
    expect(root.fromConfig).not.toBe(root.createAgent);
  });

  it('Test D: internals.js value exports (AgentClient, PostTurnAction) remain intact', () => {
    // REQ-004.1: the concrete AgentClient class stays a runtime value on the
    // documented internals subpath.
    expect(typeof internals.AgentClient).toBe('function');
    // PostTurnAction is a value (enum/const) on internals.
    expect(internals.PostTurnAction).not.toBeUndefined();

    const internalsKeys = new Set(Object.keys(internals));
    expect(internalsKeys.has('AgentClient')).toBe(true);
    expect(internalsKeys.has('PostTurnAction')).toBe(true);
  });

  it('PROP: every sampled #1594-era root key is present in the dynamic root barrel (REQ-006)', () => {
    // Property over the curated expected key set: each sampled key MUST be a
    // live key of the dynamically-enumerated root barrel.
    const expectedRootKeys: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'AdapterError',
      'createTaskToolRegistration',
      'AgenticLoop',
    ];
    const rootKeys = new Set(Object.keys(root));
    fc.assert(
      fc.property(fc.constantFrom(...expectedRootKeys), (key) =>
        rootKeys.has(key),
      ),
    );
    // A second distinct property: each sampled value-symbol is callable.
    const valueSymbols: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'AdapterError',
      'createTaskToolRegistration',
      'AgenticLoop',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...valueSymbols),
        (key) => typeof (root as Record<string, unknown>)[key] === 'function',
      ),
    );
  }, 30000);
});
