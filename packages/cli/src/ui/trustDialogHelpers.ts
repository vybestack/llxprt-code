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

function buildTrustRadioOptions<T extends string>(
  currentFolder: string,
  parentFolder: string,
  values: {
    readonly trustFolder: T;
    readonly trustParent: T;
    readonly doNotTrust: T;
  },
): Array<RadioSelectItem<T>> {
  return [
    {
      label: `Trust folder (${currentFolder})`,
      value: values.trustFolder,
      key: values.trustFolder,
    },
    {
      label: `Trust parent folder (${parentFolder})`,
      value: values.trustParent,
      key: values.trustParent,
    },
    {
      label: "Don't trust",
      value: values.doNotTrust,
      key: values.doNotTrust,
    },
  ];
}

export function buildTrustOptions(
  currentFolder: string,
  parentFolder: string,
): Array<RadioSelectItem<FolderTrustChoice>> {
  return buildTrustRadioOptions(currentFolder, parentFolder, {
    trustFolder: FolderTrustChoice.TRUST_FOLDER,
    trustParent: FolderTrustChoice.TRUST_PARENT,
    doNotTrust: FolderTrustChoice.DO_NOT_TRUST,
  });
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
    if (currentTrustLevel === TrustLevel.DO_NOT_TRUST) {
      return 'This folder is not trusted because a local rule overrides the trusted parent folder.';
    }
    return 'This folder is trusted via a parent folder setting. You can override it with a more specific rule.';
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

export function combineTrustUpdateFailure(
  error: unknown,
  rollbackFailures: readonly unknown[],
  aggregateMessage: string,
): { error: unknown; rollbackSucceeded: boolean } {
  if (rollbackFailures.length === 0) {
    return { error, rollbackSucceeded: true };
  }
  return {
    error: new AggregateError([error, ...rollbackFailures], aggregateMessage),
    rollbackSucceeded: false,
  };
}

export function getTrustCommitErrorMessage(
  phase: 'persistence' | 'live',
  error: unknown,
  rollbackSucceeded = true,
): string {
  const detail = flattenErrorDetails(error).join('; ');
  if (phase === 'persistence') {
    return rollbackSucceeded
      ? `Failed to save trust settings: ${detail}`
      : `Failed to save trust settings and rollback was incomplete: ${detail}`;
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
  return buildTrustRadioOptions(folderName, parentFolderName, {
    trustFolder: TrustLevel.TRUST_FOLDER,
    trustParent: TrustLevel.TRUST_PARENT,
    doNotTrust: TrustLevel.DO_NOT_TRUST,
  });
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
