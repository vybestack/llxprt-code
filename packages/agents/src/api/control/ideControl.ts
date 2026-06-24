/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-014
 */

import type { AgentIdeControl, IdeInfo, IdeStatus } from '../agent.js';
import type { EditorCallbacks } from '../config-types.js';
import {
  detectIdeFromEnv,
  isFakeIdeActive,
  loadFakeIdeFixture,
  trustFakeIde,
  type FakeIdeFixture,
  type FakeIdeFixtureEntry,
} from '@vybestack/llxprt-code-ide-integration';

/**
 * Callback bundle injected by AgentImpl so IdeControl can read the live IDE
 * mode flag and fire the SHARED editor callbacks (the same holder
 * `tools.setEditorCallbacks` writes).
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-014
 */
export interface IdeControlDeps {
  /** True when IDE mode is enabled in the agent's Config. */
  readonly ideModeEnabled: () => boolean;
  /** Reads the current shared editor-callbacks bundle (live, not snapshotted). */
  readonly getEditorCallbacks: () => EditorCallbacks;
}

/** Maps a fake-fixture entry onto the public IdeInfo shape. */
function toIdeInfo(entry: FakeIdeFixtureEntry): IdeInfo {
  return {
    name: entry.name,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    trusted: entry.trusted ?? false,
  };
}

export class IdeControl implements AgentIdeControl {
  constructor(private readonly deps?: IdeControlDeps) {}

  /**
   * Reads the fake IDE fixture when the shipped fake-IDE seam is active,
   * otherwise returns undefined so the real-environment path is used.
   */
  private fakeFixture(): FakeIdeFixture | undefined {
    if (!isFakeIdeActive()) {
      return undefined;
    }
    return loadFakeIdeFixture();
  }

  current(): IdeInfo | null {
    const fixture = this.fakeFixture();
    if (fixture !== undefined) {
      const currentName = fixture.currentName ?? null;
      if (currentName === null) {
        return null;
      }
      const entry = fixture.detected.find((d) => d.name === currentName);
      return entry !== undefined ? toIdeInfo(entry) : null;
    }
    // Real environment: detect the active IDE from the process environment.
    const detected = detectIdeFromEnv();
    return {
      name: detected.name,
      trusted: false,
    };
  }

  detected(): readonly IdeInfo[] {
    const fixture = this.fakeFixture();
    if (fixture !== undefined) {
      return fixture.detected.map(toIdeInfo);
    }
    const detected = detectIdeFromEnv();
    return [
      {
        name: detected.name,
        trusted: false,
      },
    ];
  }

  async trust(name: string): Promise<void> {
    // When the IDE seam is active, record trust through it. Outside the seam,
    // trust is a workspace-level decision owned by the IDE companion, so there
    // is no per-name trust mutation to perform on the runtime surface.
    if (isFakeIdeActive()) {
      trustFakeIde(name);
    }
  }

  status(): IdeStatus {
    return {
      current: this.current(),
      detected: this.detected(),
      modeEnabled: this.deps?.ideModeEnabled() ?? false,
    };
  }

  async openEditor(): Promise<void> {
    const callbacks = this.deps?.getEditorCallbacks();
    callbacks?.onEditorOpen?.();
  }

  async closeEditor(): Promise<void> {
    const callbacks = this.deps?.getEditorCallbacks();
    callbacks?.onEditorClose?.();
  }
}
