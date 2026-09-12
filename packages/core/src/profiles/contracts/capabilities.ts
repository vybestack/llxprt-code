/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from './profileCommands.js';
import type { ProfileCommandResult } from './profileResults.js';
import type { RedactedProfileEvent } from './profileEvents.js';
import type { ProfileDocument } from './profileDocument.js';
import type { ProfileHealth, RedactedProfileSnapshot } from './profileViews.js';
import type { ToolPolicySnapshot } from './routingContexts.js';

/**
 * Narrow read-only capability over the profile workspace. A capability exposes one
 * focused surface and nothing else: it is never a service bag handing out credentials,
 * the SettingsService, the ProviderManager, or a generic services object.
 */
export interface ProfileQueryCapability {
  getSnapshot(): RedactedProfileSnapshot;
  getRevision(): number;
  getHealth(): ProfileHealth;
  subscribe(listener: (event: RedactedProfileEvent) => void): () => void;
}

/**
 * Query surface plus the ability to drive profile transitions by dispatching commands.
 */
export interface AgentProfileCapability extends ProfileQueryCapability {
  transition(command: ProfileCommand): Promise<ProfileCommandResult>;
}

/**
 * Direct access to the raw profile document.
 *
 * For repository and runtime-factory boundaries only: this capability intentionally leaks
 * the unredacted document, so it must never be exposed to UI or API layers.
 */
export interface ProfileDocumentReadCapability {
  getDocument(): ProfileDocument;
}

/**
 * Read access to the tool policy captured at a routing decision point.
 */
export interface PolicySnapshotReadCapability {
  getPolicySnapshot(): ToolPolicySnapshot;
}
