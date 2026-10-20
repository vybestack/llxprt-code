/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-014
 */
import type {
  WorkspaceIdePort,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';

import type {
  AgentIdeControl,
  IdeInfo,
  IdeStatus,
  Unsubscribe,
} from '../agent.js';
import type { WorkspaceIdeConnection } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import type { IdeContext } from '@vybestack/llxprt-code-ide-integration';
import type { EditorCallbacks } from '../config-types.js';
import {
  detectIdeFromEnv,
  isFakeIdeActive,
  loadFakeIdeFixture,
  trustFakeIde,
  type FakeIdeFixture,
  type FakeIdeFixtureEntry,
} from '@vybestack/llxprt-code-ide-integration';

export function assembleIdeControl(
  trust: WorkspaceTrustControlPort,
  ide: WorkspaceIdePort,
  getEditorCallbacks: () => EditorCallbacks,
): IdeControl {
  return new IdeControl(trust, ide, () => ide.isEnabled(), getEditorCallbacks);
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
  private closed = false;
  private readonly subscriptions = new Set<Unsubscribe>();

  constructor(
    private readonly trustOwner: WorkspaceTrustControlPort,
    private readonly ideOwner: WorkspaceIdePort,
    private readonly readModeEnabled: () => boolean,
    private readonly readEditorCallbacks: () => EditorCallbacks,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new Error('Agent IDE control is disposed');
  }

  closeAdmission(): void {
    this.closed = true;
    const failures: unknown[] = [];
    for (const unsubscribe of this.subscriptions) {
      try {
        unsubscribe();
      } catch (error) {
        failures.push(error);
      }
    }
    this.subscriptions.clear();
    if (failures.length > 0)
      throw new AggregateError(failures, 'IDE subscriptions cleanup failed');
  }

  private ownSubscription(unsubscribe: Unsubscribe): Unsubscribe {
    const release = (): void => {
      if (this.subscriptions.delete(release)) unsubscribe();
    };
    this.subscriptions.add(release);
    return release;
  }

  readConnection(): WorkspaceIdeConnection {
    this.assertOpen();
    return this.ideOwner.readConnection();
  }

  readContext(): IdeContext | undefined {
    this.assertOpen();
    return this.ideOwner.readContext();
  }

  readWorkspaceTrust(): boolean | undefined {
    this.assertOpen();
    return this.ideOwner.readWorkspaceTrust();
  }

  subscribeContext(
    listener: (context: IdeContext | undefined) => void,
  ): Unsubscribe {
    this.assertOpen();
    return this.ownSubscription(this.ideOwner.subscribeContext(listener));
  }

  subscribeWorkspaceTrust(
    listener: (trusted: boolean | undefined) => void,
  ): Unsubscribe {
    this.assertOpen();
    return this.ownSubscription(
      this.ideOwner.subscribeWorkspaceTrust(listener),
    );
  }

  subscribeConnection(
    listener: (connection: WorkspaceIdeConnection) => void,
  ): Unsubscribe {
    this.assertOpen();
    return this.ownSubscription(this.ideOwner.subscribeConnection(listener));
  }

  async resolveDiff(
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    this.assertOpen();
    await this.ideOwner.resolveDiff(filePath, outcome);
  }

  isTrustedFolder(): boolean {
    return this.trustOwner.isTrustedFolder();
  }
  getIdeTrust(): boolean | undefined {
    return this.trustOwner.getIdeTrust();
  }
  setTrustedFolderLive(trusted: boolean): Promise<void> {
    return this.trustOwner.setTrustedFolderLive(trusted);
  }
  whenTrustTransitionSettled(): Promise<void> {
    return this.trustOwner.whenSettled();
  }
  getIdeMode(): boolean {
    return this.ideOwner.isEnabled();
  }
  setIdeMode(enabled: boolean): void {
    this.ideOwner.setEnabled(enabled);
  }
  async setIdeClientConnected(): Promise<void> {
    this.assertOpen();
    await this.ideOwner.connect();
  }
  async setIdeClientDisconnected(): Promise<void> {
    this.assertOpen();
    await this.ideOwner.disconnect();
  }

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
      trusted: this.isTrustedFolder(),
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
        trusted: this.isTrustedFolder(),
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
      modeEnabled: this.readModeEnabled(),
    };
  }

  async openEditor(): Promise<void> {
    const callbacks = this.readEditorCallbacks();
    callbacks.onEditorOpen?.();
  }

  async closeEditor(): Promise<void> {
    const callbacks = this.readEditorCallbacks();
    callbacks.onEditorClose?.();
  }
}
