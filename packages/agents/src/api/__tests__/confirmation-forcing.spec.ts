/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 *
 * Behavioral tests for the confirmation-forcing seam. Drives the REAL
 * production functions (injectConfirmationForcingPolicy,
 * wrapRegistryWithConfirmation) over a REAL PolicyEngine and a REAL
 * declarative tool, asserting on observable VALUES:
 *  - the injected ASK rule changes a real engine's evaluate() outcome;
 *  - a wrapped tool's invocation surfaces info-variant confirmation details
 *    with the exact title/prompt the seam promises;
 *  - param aliases (path/dir → absolute_path) are remapped by VALUE before the
 *    underlying tool's build() sees them, and never overwrite a present
 *    canonical key;
 *  - getTool/getAllTools/getEnabledTools all return confirming tools, while
 *    other registry members delegate unchanged.
 */

import { describe, it, expect } from 'vitest';
import {
  createConfirmationForcingProbe,
  applyForcingPolicy,
  buildAndConfirm,
  narrowConfirmDetails,
  PolicyDecision,
} from './helpers/confirmationForcingProbe.js';

describe('Confirmation forcing seam @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
  it('injectConfirmationForcingPolicy makes a real engine return ASK_USER for every tool (overriding the default) @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const probe = createConfirmationForcingProbe('read_file');

    // Before injection the empty engine has no ASK rule for an arbitrary tool;
    // its default is ASK_USER, so prove the injected rule is what is matched by
    // confirming it survives an explicit ALLOW rule at a lower priority.
    probe.policyEngine.addRule({
      toolName: undefined,
      decision: PolicyDecision.ALLOW,
      priority: 1.05,
    });
    expect(probe.policyEngine.evaluate('read_file', {})).toBe(
      PolicyDecision.ALLOW,
    );

    applyForcingPolicy(probe);

    // The priority-4 ASK rule now outranks the priority-1.05 ALLOW rule for
    // ALL tools — the observable engine decision flips to ASK_USER.
    expect(probe.policyEngine.evaluate('read_file', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    expect(probe.policyEngine.evaluate('list_directory', {})).toBe(
      PolicyDecision.ASK_USER,
    );
    expect(probe.policyEngine.evaluate('any_other_tool', {})).toBe(
      PolicyDecision.ASK_USER,
    );

    // The injected rule is retained in the engine with its provenance label,
    // matching every tool (toolName undefined) at the forcing priority.
    const injected = probe.policyEngine
      .getRules()
      .find((r) => r.priority === 4.0);
    expect(injected).toBeDefined();
    expect(injected?.decision).toBe(PolicyDecision.ASK_USER);
    expect(injected?.toolName).toBeUndefined();
    expect(injected?.source).toBe('Agent confirmation-forcing seam (P17)');
  });

  it('a wrapped tool invocation surfaces info-variant confirmation details with the seam title and prompt @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    const result = await buildAndConfirm(probe, { absolute_path: '/x' });
    const details = narrowConfirmDetails(result.details);

    expect(details.type).toBe('info');
    expect(details.title).toBe('Confirm tool execution');
    // info-variant carries a prompt the public stream surfaces.
    expect((details as { prompt: string }).prompt).toBe(
      'Allow this tool to run?',
    );
  });

  it('the forced confirmation onConfirm resolves without throwing (coordinator drives execution) @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    const result = await buildAndConfirm(probe, { absolute_path: '/x' });
    const details = narrowConfirmDetails(result.details);
    const onConfirm = (details as { onConfirm: () => Promise<void> }).onConfirm;
    await expect(onConfirm()).resolves.toBeUndefined();
  });

  it('non-build invocation members delegate to the real invocation bound to this @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    const { invocation } = await buildAndConfirm(probe, {
      absolute_path: '/etc/passwd',
    });
    // getDescription is NOT shouldConfirmExecute — it must return the real
    // invocation's value, computed from `this.params` (proving correct
    // delegation + this-binding, not the forced-confirmation function).
    expect(invocation.getDescription()).toBe('probe:/etc/passwd');
    // execute() likewise delegates and reads this.params
    const result = await invocation.execute(new AbortController().signal);
    expect(result.llmContent).toBe('executed:/etc/passwd');

    // Detach the method from the proxy and call it standalone: the wrapper
    // must hand back a `this`-BOUND function, so the detached call still reads
    // this.params correctly (an unbound delegation would lose `this`).
    const detached = invocation.getDescription;
    expect(detached()).toBe('probe:/etc/passwd');
  });

  it('non-build tool members delegate to the real tool bound to this @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const probe = createConfirmationForcingProbe('read_file');
    const tool = probe.wrappedRegistry.getTool('read_file');
    expect(tool).toBeDefined();
    // validateToolParams reads this.schema (this-dependent). Correct
    // delegation+binding returns null for a structurally valid params object.
    expect(tool?.validateToolParams({ absolute_path: '/x' })).toBeNull();
    // the schema getter (this-dependent) reflects the real tool's name
    expect(tool?.schema.name).toBe('read_file');

    // Detach a delegated tool method and call it standalone: the wrapper must
    // return a `this`-BOUND function, so validation still reads this.schema.
    const detachedValidate = tool?.validateToolParams;
    expect(detachedValidate?.({ absolute_path: '/y' })).toBeNull();
  });

  it('remaps the path alias to absolute_path by value before the underlying build() sees it @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    await buildAndConfirm(probe, { path: '/etc/hosts' });

    const seen = probe.lastBuildParams();
    expect(seen).toBeDefined();
    // canonical key was synthesized from the alias VALUE
    expect(seen?.absolute_path).toBe('/etc/hosts');
    // original alias key is preserved (shallow copy, never deleted)
    expect((seen as Record<string, unknown>).path).toBe('/etc/hosts');
  });

  it('remaps the dir alias to absolute_path by value @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('list_directory');
    await buildAndConfirm(probe, { dir: '/tmp' });

    const seen = probe.lastBuildParams();
    expect(seen?.absolute_path).toBe('/tmp');
  });

  it('never overwrites a present canonical key when the alias is also present @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    await buildAndConfirm(probe, {
      path: '/from-alias',
      absolute_path: '/canonical',
    });

    const seen = probe.lastBuildParams();
    // canonical wins — alias does NOT clobber it
    expect(seen?.absolute_path).toBe('/canonical');
    expect((seen as Record<string, unknown>).path).toBe('/from-alias');
  });

  it('leaves args with no alias keys structurally unchanged (no spurious absolute_path) @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');
    await buildAndConfirm(probe, { pattern: '*.ts', limit: 5 });

    const seen = probe.lastBuildParams();
    expect(seen).toStrictEqual({ pattern: '*.ts', limit: 5 });
    expect('absolute_path' in (seen ?? {})).toBe(false);
  });

  it('getAllTools and getEnabledTools both return confirming tools @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const probe = createConfirmationForcingProbe('read_file');

    const all = probe.wrappedRegistry.getAllTools();
    const enabled = probe.wrappedRegistry.getEnabledTools();
    expect(all).toHaveLength(1);
    expect(enabled).toHaveLength(1);

    for (const tool of [all[0], enabled[0]]) {
      const invocation = tool.build({ absolute_path: '/x' });
      const details = narrowConfirmDetails(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      );
      expect(details.type).toBe('info');
      expect(details.title).toBe('Confirm tool execution');
    }
  });

  it('getTool returns undefined for an unknown tool (delegates the miss, does not wrap undefined) @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const probe = createConfirmationForcingProbe('read_file');
    expect(probe.wrappedRegistry.getTool('does_not_exist')).toBeUndefined();
  });

  it('delegates non-wrapped registry members unchanged @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const probe = createConfirmationForcingProbe('read_file');
    const wrapped = probe.wrappedRegistry as unknown as {
      getToolNamesForPrompt(): string[];
      describeRegistry(): string;
      registryKind: string;
    };
    // a delegated METHOD returns the underlying registry's real value
    expect(wrapped.getToolNamesForPrompt()).toStrictEqual(['read_file']);
    // a delegated DATA property passes straight through (proving the wrapper
    // does NOT treat non-functions as bindable — a function-always branch
    // would throw trying to .bind a string)
    expect(wrapped.registryKind).toBe('structural-probe-registry');

    // Detach a delegated, this-reading registry method and call it standalone:
    // the wrapper returns a `this`-BOUND function, so it still reads
    // this.registryKind (an unbound delegation would lose `this`).
    const detached = wrapped.describeRegistry;
    expect(detached()).toBe('structural-probe-registry');
  });

  it('preserves the underlying tool identity fields through the build wrapper @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const probe = createConfirmationForcingProbe('read_file');
    const tool = probe.wrappedRegistry.getTool('read_file');
    expect(tool).toBeDefined();
    // delegated (non-build) members reflect the real tool's values
    expect(tool?.name).toBe('read_file');
    expect(tool?.description).toBe('probe tool');
  });
});
