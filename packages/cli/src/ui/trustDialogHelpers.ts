/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TrustLevel } from '../config/trustedFolders.js';
import type { RadioSelectItem } from './components/shared/RadioButtonSelect.js';

export enum FolderTrustChoice {
  TRUST_FOLDER = 'trust_folder',
  TRUST_PARENT = 'trust_parent',
  DO_NOT_TRUST = 'do_not_trust',
}

export function buildTrustOptions(
  currentFolder: string,
  parentFolder: string,
): Array<RadioSelectItem<FolderTrustChoice>> {
  return [
    {
      label: `Trust folder (${currentFolder})`,
      value: FolderTrustChoice.TRUST_FOLDER,
      key: FolderTrustChoice.TRUST_FOLDER,
    },
    {
      label: `Trust parent folder (${parentFolder})`,
      value: FolderTrustChoice.TRUST_PARENT,
      key: `Trust parent folder (${parentFolder})`,
    },
    {
      label: "Don't trust",
      value: FolderTrustChoice.DO_NOT_TRUST,
      key: "Don't trust",
    },
  ];
}

export function getLocalTrustLevelDisplay(
  level: TrustLevel | undefined,
): string {
  switch (level) {
    case TrustLevel.TRUST_FOLDER:
      return 'Trusted';
    case TrustLevel.TRUST_PARENT:
      return 'Trust parent';
    case TrustLevel.DO_NOT_TRUST:
      return 'Not trusted';
    default:
      return 'Not set';
  }
}

export function getTrustLevelDisplay(
  level: TrustLevel | undefined,
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
): string {
  if (isIdeTrusted !== undefined) {
    return isIdeTrusted ? 'Trusted (via IDE)' : 'Not trusted (via IDE)';
  }
  const localDisplay = getLocalTrustLevelDisplay(level);
  if (isParentTrusted === true) {
    return level === undefined
      ? 'Trusted (via parent folder)'
      : `${localDisplay} (via parent folder)`;
  }
  return localDisplay;
}

export function getWarningMessage(
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
  currentTrustLevel: TrustLevel | undefined,
): string | null {
  if (isIdeTrusted !== undefined) {
    const status = isIdeTrusted ? 'trusted' : 'not trusted';
    return `This folder is ${status} via your IDE settings. Changes here save a local fallback for use without the IDE.`;
  }
  if (isParentTrusted === true) {
    const status =
      currentTrustLevel === TrustLevel.DO_NOT_TRUST ? 'not trusted' : 'trusted';
    return `This folder is ${status} via a parent folder setting. You can override it with a more specific rule.`;
  }
  return null;
}

export function getTrustUpdateDisplay(
  committedTrustLevel: TrustLevel | undefined,
  effectiveTrust: boolean | undefined,
  isIdeTrusted: boolean | undefined,
): { savedLocalFallback: string; effectiveNow: string } {
  let effectiveTrustLevel: TrustLevel | undefined;
  if (effectiveTrust !== undefined) {
    effectiveTrustLevel = effectiveTrust
      ? TrustLevel.TRUST_FOLDER
      : TrustLevel.DO_NOT_TRUST;
  }
  return {
    savedLocalFallback: getLocalTrustLevelDisplay(committedTrustLevel),
    effectiveNow: getTrustLevelDisplay(
      effectiveTrustLevel,
      isIdeTrusted,
      false,
    ),
  };
}

function flattenErrorDetails(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap(flattenErrorDetails);
  }
  return [error instanceof Error ? error.message : String(error)];
}

export function getTrustCommitErrorMessage(
  phase: 'persistence' | 'live',
  error: unknown,
  rollbackSucceeded = true,
): string {
  const detail = flattenErrorDetails(error).join('; ');
  if (phase === 'persistence') {
    return `Failed to save trust settings: ${detail}`;
  }
  return rollbackSucceeded
    ? `Trust settings could not be applied live, so the saved setting was restored: ${detail}`
    : `Trust settings could not be applied live and rollback was incomplete: ${detail}`;
}

export function shouldDismissTrustDialog(
  showUpdatedPrompt: boolean,
  keyName: string,
): boolean {
  return keyName === 'escape' || (showUpdatedPrompt && keyName === 'return');
}

export function buildTrustLevelOptions(
  folderName: string,
  parentFolderName: string,
): Array<RadioSelectItem<TrustLevel>> {
  return [
    {
      label: `Trust this folder (${folderName})`,
      value: TrustLevel.TRUST_FOLDER,
      key: TrustLevel.TRUST_FOLDER,
    },
    {
      label: `Trust parent folder (${parentFolderName})`,
      value: TrustLevel.TRUST_PARENT,
      key: TrustLevel.TRUST_PARENT,
    },
    {
      label: "Don't trust",
      value: TrustLevel.DO_NOT_TRUST,
      key: TrustLevel.DO_NOT_TRUST,
    },
  ];
}

export function findInitialTrustOptionIndex(
  options: Array<RadioSelectItem<TrustLevel>>,
  currentTrustLevel: TrustLevel | undefined,
): number {
  const index = options.findIndex(
    (option) => option.value === currentTrustLevel,
  );
  return index >= 0 ? index : 0;
}
