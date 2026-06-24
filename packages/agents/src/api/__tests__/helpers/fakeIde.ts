/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-014
 *
 * Fake IDE/editor environment (infra fake — NOT the Agent under test).
 * Lives under __tests__/helpers/ so deep imports are permitted here while
 * staying excluded from the T17 boundary scan.
 *
 * The fake simulates a detected IDE, trust state, and editor open/close
 * lifecycle so specs can drive the real public agent.ide.* surface through
 * realistic infra without spawning a real LSP/editor connection.
 */

import { afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IdeInfo } from '@vybestack/llxprt-code-agents';
import { detectIdeFromEnv } from '@vybestack/llxprt-code-ide-integration';

/**
 * Deactivates the shipped fake-IDE seam for the current test so IdeControl
 * exercises its REAL-environment detection path (detectIdeFromEnv). The
 * fakeIde afterEach also clears the var, but tests that must run on the
 * real path call this up-front to be explicit and order-independent.
 */
export function deactivateFakeIde(): void {
  delete process.env.LLXPRT_FAKE_IDE;
}

/**
 * The IDE name the real-environment detector resolves for the current process
 * environment. Lets a spec ground an assertion on the real detection path
 * (which is env-dependent) without deep-importing detection internals.
 */
export function realEnvDetectedName(): string {
  return detectIdeFromEnv().name;
}

// Clear the shipped fake-IDE seam env var after every test so the fixture path
// never leaks into a sibling spec sharing the same worker process. The seam is
// strictly opt-in: an unset LLXPRT_FAKE_IDE disables the fake environment.
afterEach(() => {
  delete process.env.LLXPRT_FAKE_IDE;
});

/**
 * Shipped fake IDE fixture shape (mirrors
 * packages/ide-integration/src/ide/fake-ide-environment.ts). The fake env
 * serializes its in-memory state into this shape and points `LLXPRT_FAKE_IDE`
 * at it so the public agent.ide control reads detected/current/trust from the
 * shipped seam — no production code reads anything from __tests__.
 */
interface FakeIdeFixtureEntryShape {
  readonly name: string;
  readonly version?: string;
  readonly trusted?: boolean;
}
interface FakeIdeFixtureShape {
  readonly currentName?: string | null;
  readonly detected: readonly FakeIdeFixtureEntryShape[];
}

/** A detected IDE in the fake environment. */
export interface FakeDetectedIde {
  readonly name: string;
  readonly version?: string;
  readonly trusted?: boolean;
}

/** Controls for the fake IDE environment. */
export interface FakeIdeEnvironment {
  /** The IDE the fake considers "current" (null when none is active). */
  setCurrent(ide: FakeDetectedIde | null): void;
  current(): IdeInfo | null;
  detected(): readonly IdeInfo[];
  /** Marks the named IDE as trusted (mutates the detected list). */
  trust(name: string): void;
  /** True while the fake editor is "open". */
  isEditorOpen(): boolean;
  /** Simulates the editor opening; returns a callback to close it. */
  openEditor(): void;
  closeEditor(): void;
  /** Add an additional detected IDE to the environment. */
  addDetected(ide: FakeDetectedIde): void;
  reset(): void;
}

class FakeIdeEnvironmentImpl implements FakeIdeEnvironment {
  private detectedList: FakeDetectedIde[] = [];
  private currentName: string | null = null;
  private editorOpen = false;
  private readonly fixturePath: string;

  constructor() {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-fake-ide-'));
    this.fixturePath = join(dir, 'ide-fixture.json');
    // Activate the shipped fake IDE seam for this process. agent.ide reads
    // LLXPRT_FAKE_IDE and projects detected/current/trust from the fixture.
    process.env.LLXPRT_FAKE_IDE = this.fixturePath;
    this.sync();
  }

  /** Serializes the current environment state into the shipped fixture file. */
  private sync(): void {
    const fixture: FakeIdeFixtureShape = {
      currentName: this.currentName,
      detected: this.detectedList.map((d) => ({
        name: d.name,
        ...(d.version !== undefined ? { version: d.version } : {}),
        trusted: d.trusted ?? false,
      })),
    };
    writeFileSync(this.fixturePath, JSON.stringify(fixture), 'utf8');
  }

  setCurrent(ide: FakeDetectedIde | null): void {
    if (ide === null) {
      this.currentName = null;
      this.sync();
      return;
    }
    // ensure it exists in detected before becoming current
    if (!this.detectedList.some((d) => d.name === ide.name)) {
      this.detectedList = [...this.detectedList, ide];
    }
    this.currentName = ide.name;
    this.sync();
  }

  current(): IdeInfo | null {
    if (this.currentName === null) {
      return null;
    }
    const found = this.detectedList.find((d) => d.name === this.currentName);
    if (!found) {
      return null;
    }
    return {
      name: found.name,
      version: found.version,
      trusted: found.trusted ?? false,
    };
  }

  detected(): readonly IdeInfo[] {
    return this.detectedList.map((d) => ({
      name: d.name,
      version: d.version,
      trusted: d.trusted ?? false,
    }));
  }

  trust(name: string): void {
    this.detectedList = this.detectedList.map((d) =>
      d.name === name ? { ...d, trusted: true } : d,
    );
    this.sync();
  }

  isEditorOpen(): boolean {
    return this.editorOpen;
  }

  openEditor(): void {
    this.editorOpen = true;
  }

  closeEditor(): void {
    this.editorOpen = false;
  }

  addDetected(ide: FakeDetectedIde): void {
    if (!this.detectedList.some((d) => d.name === ide.name)) {
      this.detectedList = [...this.detectedList, ide];
    }
    this.sync();
  }

  reset(): void {
    this.detectedList = [];
    this.currentName = null;
    this.editorOpen = false;
    this.sync();
  }
}

/**
 * Builds a fresh, isolated fake IDE environment. Each call yields an
 * independent environment so tests do not leak detected/trust state.
 */
export function createFakeIdeEnvironment(): FakeIdeEnvironment {
  return new FakeIdeEnvironmentImpl();
}

/**
 * Activates the fake-IDE seam pointing at a hand-written fixture whose
 * `currentName` references an IDE that is NOT present in `detected`. This
 * exercises the IdeControl "current pointer dangles" branch (resolves to null)
 * which the high-level env API cannot produce because setCurrent auto-adds.
 */
export function writeDanglingCurrentFixture(
  currentName: string,
  detected: readonly FakeDetectedIde[],
): void {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-fake-ide-dangling-'));
  const fixturePath = join(dir, 'ide-fixture.json');
  const fixture: FakeIdeFixtureShape = {
    currentName,
    detected: detected.map((d) => ({
      name: d.name,
      ...(d.version !== undefined ? { version: d.version } : {}),
      trusted: d.trusted ?? false,
    })),
  };
  writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  process.env.LLXPRT_FAKE_IDE = fixturePath;
}

/**
 * Convenience: a fake environment pre-seeded with a current + one detected IDE.
 */
export function fakeIdeWithCurrent(
  currentName: string,
  detected: readonly FakeDetectedIde[],
): { readonly env: FakeIdeEnvironment; readonly current: IdeInfo | null } {
  const env = createFakeIdeEnvironment();
  for (const d of detected) {
    env.addDetected(d);
  }
  env.setCurrent(detected.find((d) => d.name === currentName) ?? null);
  return { env, current: env.current() };
}
