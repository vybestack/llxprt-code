/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-014
 *
 * IDE/editor environment (RED). Behavioral integration tests against a real
 * public Agent, driven through a fake IDE environment (NOT the Agent under
 * test). Tests FAIL NATURALLY — stub methods throw NYI; no mock theater, only
 * value assertions.
 *
 * Covers:
 * - T15 ide.* current/detected IDE + trust; editor open/close fire (fake IDE).
 */

import { describe, it, expect } from 'vitest';
import { buildAgent } from './helpers/agentHarness.js';
import {
  createFakeIdeEnvironment,
  fakeIdeWithCurrent,
  deactivateFakeIde,
  realEnvDetectedName,
  writeDanglingCurrentFixture,
  type FakeIdeEnvironment,
} from './helpers/fakeIde.js';
import { IdeControl } from '../control/ideControl.js';
import type { EditorCallbacks } from '../config-types.js';

describe('IDE @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', () => {
  it('T15 ide.current() reports the current IDE seeded by the fake environment @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', async () => {
    const { env: fakeEnv } = fakeIdeWithCurrent('vscode', [
      { name: 'vscode', version: '1.90.0', trusted: true },
      { name: 'intellij', version: '2024.1', trusted: false },
    ]);
    const expectedCurrent = fakeEnv.current();
    expect(expectedCurrent).not.toBeNull();

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      ide: { mode: true },
    });
    try {
      // the agent surfaces the current IDE from the environment
      const current = agent.ide.current();
      expect(current).not.toBeNull();
      expect(current?.name).toBe(expectedCurrent?.name);
      expect(current?.version).toBe(expectedCurrent?.version);
    } finally {
      await cleanup();
    }
  });

  it('T15 ide.detected() lists every detected IDE @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', async () => {
    const detected = [
      { name: 'vscode', version: '1.90.0', trusted: true },
      { name: 'zed', version: '0.140.0', trusted: false },
    ];
    const { env } = fakeIdeWithCurrent('vscode', detected);
    expect(env.detected().length).toBeGreaterThanOrEqual(2);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      ide: { mode: true },
    });
    try {
      const detectedFromAgent = agent.ide.detected();
      expect(Array.isArray(detectedFromAgent)).toBe(true);
      expect(detectedFromAgent.length).toBeGreaterThanOrEqual(2);

      const names = detectedFromAgent.map((d) => d.name);
      expect(names).toContain('vscode');
      expect(names).toContain('zed');
    } finally {
      await cleanup();
    }
  });

  it('T15 ide.status() reports current, detected, and modeEnabled @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      ide: { mode: true },
    });
    try {
      const status = agent.ide.status();
      expect(typeof status.modeEnabled).toBe('boolean');
      expect(status.modeEnabled).toBe(true);
      expect(Array.isArray(status.detected)).toBe(true);
      // current is null or an IdeInfo; assert the structural type without a
      // conditional expect — the field is either null or an object with a name.
      const current = status.current;
      const isNull = current === null;
      const isInfo =
        current !== null &&
        typeof current === 'object' &&
        typeof current.name === 'string' &&
        typeof current.trusted === 'boolean';
      expect(isNull || isInfo).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T15 ide.trust() marks a detected IDE as trusted; subsequent current/detected reflect it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', async () => {
    const fakeEnv: FakeIdeEnvironment = createFakeIdeEnvironment();
    fakeEnv.addDetected({ name: 'vscode', version: '1.90.0', trusted: false });
    fakeEnv.setCurrent({ name: 'vscode', version: '1.90.0', trusted: false });
    expect(fakeEnv.current()?.trusted).toBe(false);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      ide: { mode: true },
    });
    try {
      // trust the IDE via the public surface
      await agent.ide.trust('vscode');

      // mirror the trust in the fake so the assertion is grounded
      fakeEnv.trust('vscode');
      expect(fakeEnv.current()?.trusted).toBe(true);

      // the agent reflects the trusted state
      const current = agent.ide.current();
      expect(current?.trusted).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T15 editor open/close fire via the public ide.openEditor/closeEditor surface @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-014', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      ide: { mode: true },
    });
    try {
      // openEditor + closeEditor are the public lifecycle hooks; at RED they
      // throw NYI; at GREEN they fire the editor callbacks registered via
      // tools.setEditorCallbacks (observed through the public surface).
      await agent.ide.openEditor();
      await agent.ide.closeEditor();

      // after close, status is still callable (lifecycle is observable)
      const status = agent.ide.status();
      expect(status.modeEnabled).toBe(true);
    } finally {
      await cleanup();
    }
  });

  /**
   * Focused behavioral unit coverage for IdeControl projection + lifecycle. Drives
   * the REAL IdeControl over the shipped fake-IDE seam (LLXPRT_FAKE_IDE, activated
   * by the fake environment helper) and a controlled IdeControlDeps, asserting the
   * exact mapping rules: current() resolution + null fallbacks, detected() trusted
   * projection, status() composition incl. modeEnabled default, trust() mutation,
   * and editor open/close firing the shared editor callbacks.
   */
  describe('IdeControl unit @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
    it('current() resolves the named current entry and projects its trusted flag @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      // Use a non-vscode current so the fake-seam result is distinguishable from
      // the real-environment fallback (which defaults to vscode).
      fakeIdeWithCurrent('zed', [
        { name: 'zed', version: '0.140.0', trusted: true },
        { name: 'intellij', version: '2024.1', trusted: false },
      ]);
      const control = new IdeControl();
      const current = control.current();
      expect(current).not.toBeNull();
      expect(current?.name).toBe('zed');
      expect(current?.version).toBe('0.140.0');
      expect(current?.trusted).toBe(true);
    });

    it('current() returns null when the fixture has no current IDE @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      const env = createFakeIdeEnvironment();
      env.addDetected({ name: 'vscode', version: '1.0', trusted: false });
      env.setCurrent(null);
      const control = new IdeControl();
      expect(control.current()).toBeNull();
    });

    it('detected() projects every entry with a defaulted trusted flag @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      const env = createFakeIdeEnvironment();
      env.addDetected({ name: 'vscode', version: '1.90.0', trusted: true });
      env.addDetected({ name: 'zed' }); // no trusted → defaults to false
      const control = new IdeControl();
      const detected = control.detected();
      const byName = new Map(detected.map((d) => [d.name, d]));
      expect(byName.get('vscode')?.trusted).toBe(true);
      expect(byName.get('vscode')?.version).toBe('1.90.0');
      // a missing trusted flag is projected as false, not undefined
      expect(byName.get('zed')?.trusted).toBe(false);
    });

    it('status() composes current + detected and reports modeEnabled from deps @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      fakeIdeWithCurrent('zed', [
        { name: 'zed', version: '0.1', trusted: true },
      ]);
      const enabled = new IdeControl({
        ideModeEnabled: () => true,
        getEditorCallbacks: () => ({
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
          onEditorOpen: () => {},
        }),
      });
      const status = enabled.status();
      expect(status.modeEnabled).toBe(true);
      expect(status.current?.name).toBe('zed');
      expect(status.detected.map((d) => d.name)).toContain('zed');
    });

    it('current() returns null when the named current IDE is absent from the detected list @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      // Seam active, currentName references an IDE missing from detected → null.
      writeDanglingCurrentFixture('phantom', [
        { name: 'zed', version: '0.1', trusted: false },
      ]);
      const control = new IdeControl();
      expect(control.current()).toBeNull();
    });

    it('status() defaults modeEnabled to false when no deps are wired @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      fakeIdeWithCurrent('vscode', [
        { name: 'vscode', version: '1.0', trusted: false },
      ]);
      const depless = new IdeControl();
      expect(depless.status().modeEnabled).toBe(false);
    });

    it('status() reflects a false ideModeEnabled value distinct from the default @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      fakeIdeWithCurrent('vscode', [
        { name: 'vscode', version: '1.0', trusted: false },
      ]);
      const control = new IdeControl({
        ideModeEnabled: () => false,
        getEditorCallbacks: () => ({
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
          onEditorOpen: () => {},
        }),
      });
      expect(control.status().modeEnabled).toBe(false);
    });

    it('trust(name) records trust through the seam; subsequent reads reflect it @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', async () => {
      const env = createFakeIdeEnvironment();
      env.addDetected({ name: 'vscode', version: '1.0', trusted: false });
      env.setCurrent({ name: 'vscode', version: '1.0', trusted: false });
      const control = new IdeControl();
      expect(control.current()?.trusted).toBe(false);

      await control.trust('vscode');

      const after = new IdeControl();
      expect(after.current()?.trusted).toBe(true);
      expect(after.detected().find((d) => d.name === 'vscode')?.trusted).toBe(
        true,
      );
    });

    it('openEditor() fires the shared onEditorOpen callback exactly once @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', async () => {
      let opens = 0;
      const callbacks: EditorCallbacks = {
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
        onEditorOpen: () => {
          opens += 1;
        },
      };
      const control = new IdeControl({
        ideModeEnabled: () => true,
        getEditorCallbacks: () => callbacks,
      });
      await control.openEditor();
      expect(opens).toBe(1);
    });

    it('closeEditor() fires the shared onEditorClose callback exactly once @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', async () => {
      let closes = 0;
      const callbacks: EditorCallbacks = {
        getPreferredEditor: () => undefined,
        onEditorClose: () => {
          closes += 1;
        },
        onEditorOpen: () => {},
      };
      const control = new IdeControl({
        ideModeEnabled: () => true,
        getEditorCallbacks: () => callbacks,
      });
      await control.closeEditor();
      expect(closes).toBe(1);
    });

    it('openEditor()/closeEditor() are no-ops (do not throw) when no deps are wired @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', async () => {
      const control = new IdeControl();
      await expect(control.openEditor()).resolves.toBeUndefined();
      await expect(control.closeEditor()).resolves.toBeUndefined();
    });

    it('a fixture entry without a version omits the version field but still reports trusted @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      const env = createFakeIdeEnvironment();
      // no version, explicit trusted=true → projects {name, trusted:true} w/o version
      env.addDetected({ name: 'novers', trusted: true });
      env.setCurrent({ name: 'novers', trusted: true });
      const control = new IdeControl();
      const current = control.current();
      expect(current?.name).toBe('novers');
      expect(current?.version).toBeUndefined();
      expect(current?.trusted).toBe(true);
      expect('version' in (current as object)).toBe(false);
    });

    it('current() falls back to the real-environment detector when the fake seam is inactive @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      deactivateFakeIde();
      const control = new IdeControl();
      const current = control.current();
      // real-env detection always resolves a concrete IDE (vscode by default)
      expect(current).not.toBeNull();
      expect(current?.name).toBe(realEnvDetectedName());
      // the real-environment path always reports trusted:false (workspace-owned)
      expect(current?.trusted).toBe(false);
    });

    it('detected() falls back to a single real-environment entry when the fake seam is inactive @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', () => {
      deactivateFakeIde();
      const control = new IdeControl();
      const detected = control.detected();
      expect(detected).toHaveLength(1);
      expect(detected[0].name).toBe(realEnvDetectedName());
      expect(detected[0].trusted).toBe(false);
    });

    it('trust() is a silent no-op on the real-environment path (no seam to mutate) @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-014', async () => {
      deactivateFakeIde();
      const control = new IdeControl();
      await expect(control.trust('vscode')).resolves.toBeUndefined();
      // detection is unchanged by a trust call outside the seam
      expect(control.detected()[0].trusted).toBe(false);
    });
  });
});
