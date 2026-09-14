/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile contract exports.
 *
 * These structural contracts describe the profile workspace surface core owns: the document
 * format, state, commands, results, events, and views, plus the immutable routing
 * contexts and the narrow capabilities built on top of them.
 */

export type { ProfileDocument } from './profileDocument.js';
export {
  isStandardProfileDocument,
  isLoadBalancerProfileDocument,
} from './profileDocument.js';
export type {
  ProfileAuthConfig,
  StandardProfileDocument,
  LoadBalancerProfileDocument,
} from './profileDocument.js';
export type {
  SourceFingerprint,
  WorkingProfileIdentity,
  CapturedStandardSource,
  ProfileState,
} from './profileState.js';
export { fingerprintsMatch } from './profileState.js';
export type {
  ProfileCommandKind,
  ProfileCommand,
  PendingConfirmation,
} from './profileCommands.js';
export { isProfileCommand } from './profileCommands.js';
export type { ProfileCommandResult } from './profileResults.js';
export { isProfileCommandResult } from './profileResults.js';
export type { ProfileEvent, RedactedProfileEvent } from './profileEvents.js';
export { toRedactedProfileEvent } from './profileEvents.js';
export type {
  RedactedProfileSnapshot,
  RedactedProfileDiff,
  ProfileHealth,
} from './profileViews.js';
export {
  SECRET_SETTING_KEYS,
  redactProfileDocument,
  redactSecrets,
  buildRedactedSnapshot,
  diffProfileDocuments,
} from './profileViews.js';
export type {
  ToolPolicySnapshot,
  AgentRoutingTarget,
  TurnContext,
  ProviderCallContext,
  ToolInvocationContext,
} from './routingContexts.js';
export { deepFreeze } from './routingContexts.js';
export {
  createTurnContext,
  createProviderCallContext,
  createToolInvocationContext,
} from './routingContexts.js';
export type {
  ProfileQueryCapability,
  AgentProfileCapability,
  ProfileDocumentReadCapability,
  PolicySnapshotReadCapability,
} from './capabilities.js';
