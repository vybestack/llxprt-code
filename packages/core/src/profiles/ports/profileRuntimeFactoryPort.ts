/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileDocument } from '../contracts/index.js';
import type { CredentialBinding } from './credentialResolverPort.js';

/**
 * Policy surface an effective profile is built with. These are the already-narrowed
 * values after profile policy was applied under the environment ceilings.
 */
export type EffectiveToolPolicy = {
  allowedTools: readonly string[];
  disabledTools: readonly string[];
  shellMode: 'allowlist' | 'all' | 'none';
  approvalCeiling: 'yolo' | 'standard' | 'strict';
};

/**
 * Fully resolved inputs a runtime binding is built from.
 */
export type ResolvedProfileSpec = {
  document: ProfileDocument;
  credentialBindings: readonly CredentialBinding[];
  policy: EffectiveToolPolicy;
  /**
   * Resolved member documents for a load-balancer spec, keyed by member name.
   * Carries the captures resolution already loaded so construction forks the
   * same immutable member sources instead of rereading the repository; absent
   * for standard documents.
   */
  memberDocuments?: Readonly<Record<string, ProfileDocument>>;
};

/**
 * A live runtime built from a {@link ResolvedProfileSpec}.
 *
 * Disposing the binding releases its runtime resources and load-balancer operational
 * state. AsyncDisposable ownership scope is what cleans a candidate binding's resources on
 * build failure or cancellation.
 */
export interface ProfileRuntimeBinding extends AsyncDisposable {
  readonly bindingId: string;
  /**
   * Structural equality key for runtime-reuse decisions. Equal configFingerprint
   * means the existing binding can be reused, preserving load-balancer operational
   * state instead of rebuilding it.
   */
  readonly configFingerprint: string;
}

/**
 * Builds runtimes out of resolved profile specs.
 *
 * `prior` is the binding currently live for the workspace, when one exists. The
 * factory owns the reuse decision: it computes the resolved spec's config fingerprint,
 * and when the prior binding's fingerprint matches the effectively unchanged spec it
 * returns the prior binding instead of constructing a duplicate. Controllers therefore
 * never build-then-dispose on the reuse path.
 */
export interface ProfileRuntimeFactoryPort {
  build(
    spec: ResolvedProfileSpec,
    prior?: ProfileRuntimeBinding,
  ): Promise<ProfileRuntimeBinding>;
}
