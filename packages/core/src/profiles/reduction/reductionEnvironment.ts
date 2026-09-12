/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ProfileDocument,
  StandardProfileDocument,
} from '../contracts/profileDocument.js';
import type {
  CapturedStandardSource,
  SourceFingerprint,
} from '../contracts/profileState.js';

/**
 * Pre-fetched plain data and pure predicates the literal reducer runs against.
 *
 * The environment carries ONLY plain data (materialized provider templates,
 * repository documents, member captures) and pure predicates
 * (isApplicationOwnedKey). All async port access — loading template and repository
 * documents, resolving credentials — happens in the caller before reduction runs, so
 * reduceProfileCommand stays pure: same state, command, and environment always
 * produce the same outcome with no I/O and no side effects.
 */
export interface ProfileReductionEnvironment {
  providerTemplates: Readonly<Record<string, StandardProfileDocument>>;
  /**
   * Model menus captured from the provider catalog before reduction runs, keyed by
   * provider. An absent entry means the catalog offered no menu for that provider,
   * so a model chosen for it stays unverified until candidate resolution runs.
   */
  providerModelMenus: Readonly<Record<string, readonly string[]>>;
  repository: Readonly<
    Record<
      string,
      { document: ProfileDocument; fingerprint: SourceFingerprint }
    >
  >;
  isApplicationOwnedKey: (key: string) => boolean;
  memberCaptures: Readonly<Record<string, CapturedStandardSource>>;
}

/**
 * Empty reduction environment: empty maps and a classifier that never treats any key as
 * application-owned. Useful as a baseline in tests and for reducers that read none
 * of the environment surfaces.
 */
export function emptyReductionEnvironment(): ProfileReductionEnvironment {
  return {
    providerTemplates: {},
    providerModelMenus: {},
    repository: {},
    isApplicationOwnedKey: () => false,
    memberCaptures: {},
  };
}
