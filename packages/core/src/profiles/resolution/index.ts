/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile resolution exports.
 *
 * Resolution turns profile intent into executable references: credential
 * bindings derived from standard documents, load-balancer member bindings, and
 * the effective tool policy under the environment and session ceilings.
 * Bindings carry references only, never secret material.
 */

export {
  deriveCredentialBindings,
  type CredentialBindingOutcome,
} from './credentialBindings.js';
export {
  deriveMemberAuthBinding,
  memberCredentialBindings,
  type MemberAuthOutcome,
  type MemberCredentialOutcome,
} from './memberAuthResolution.js';
export {
  intersectPolicy,
  type ProfilePolicyIntent,
  type PolicyCeiling,
  type PolicyExplanation,
  type PolicyIntersectionOutcome,
} from './policyIntersection.js';
export {
  resolveProfileCandidate,
  type ProfileCandidateResolutionInput,
  type ResolveProfileCandidateDeps,
  type ProfileCandidateResolution,
} from './resolveProfileCandidate.js';
