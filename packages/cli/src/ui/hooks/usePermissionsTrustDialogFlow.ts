/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as path from 'node:path';
import { isTrustLevel, type TrustLevel } from '../../config/trustedFolders.js';
import {
  getTrustPathProblemMessage,
  resolveTrustDirectory,
} from '../../config/trustPaths.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RadioSelectItem } from '../components/shared/RadioButtonSelect.js';
import {
  usePermissionsModifyTrust,
  type PermissionsTrustRuntime,
  type UsePermissionsModifyTrustReturn,
} from './usePermissionsModifyTrust.js';
import {
  buildTrustFormOptions,
  findInitialTrustOptionIndex,
  getLocalTrustLevelDisplay,
  getTrustCommitErrorMessage,
  getTrustLevelDisplay,
  getTrustUpdateDisplay,
  getWarningMessage,
  isTrustFormAction,
  TrustFormAction,
  type TrustFormChoice,
} from '../trustDialogHelpers.js';

/** Which view of the permissions dialog is currently shown. */
export type TrustDialogView = 'form' | 'path-entry' | 'rules' | 'updated';

/** Where the trust form was opened from, so Escape can step back correctly. */
type FormOrigin = 'root' | 'rules';

function reportError(
  addItem: UseHistoryManagerReturn['addItem'],
  text: string,
): void {
  addItem(
    { type: MessageType.ERROR, text } as HistoryItemWithoutId,
    Date.now(),
  );
}

function reportInfo(
  addItem: UseHistoryManagerReturn['addItem'],
  text: string,
): void {
  addItem({ type: MessageType.INFO, text } as HistoryItemWithoutId, Date.now());
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useMountedRef(): React.MutableRefObject<boolean> {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

interface CommitDeps {
  trust: UsePermissionsModifyTrustReturn;
  addItem: UseHistoryManagerReturn['addItem'];
  onExit: () => void;
  setView: React.Dispatch<React.SetStateAction<TrustDialogView>>;
  setFormOrigin: React.Dispatch<React.SetStateAction<FormOrigin>>;
  setIsCommitting: React.Dispatch<React.SetStateAction<boolean>>;
  committingRef: React.MutableRefObject<boolean>;
  mountedRef: React.MutableRefObject<boolean>;
}

/**
 * Reports what a successful commit did.
 *
 * A folder other than the working directory also gets the workspace step:
 * trust is a precondition for reaching a folder, not a grant, since the file
 * tools accept only paths inside the workspace whatever the trust level. Saying
 * just "set to Trusted" reads as access that was not given.
 */
function reportCommitOutcome(
  addItem: UseHistoryManagerReturn['addItem'],
  targetPath: string,
  level: TrustLevel,
  changed: boolean,
  isTargetCwd: boolean,
): void {
  reportInfo(
    addItem,
    changed
      ? `Trust level for ${targetPath} set to ${getLocalTrustLevelDisplay(level)}.`
      : `Trust level unchanged for ${targetPath}`,
  );
  if (!isTargetCwd) {
    reportInfo(
      addItem,
      `${targetPath} is not in this workspace. Run "/directory add ${targetPath}" to let file tools read and write there.`,
    );
  }
}

function useCommitLevel({
  trust,
  addItem,
  onExit,
  setView,
  setFormOrigin,
  setIsCommitting,
  committingRef,
  mountedRef,
}: CommitDeps): (level: TrustLevel) => Promise<void> {
  const {
    commitTrustLevel,
    pendingTrustLevel,
    targetPath,
    isTargetCwd,
    setTargetPath,
    workingDirectory,
  } = trust;
  return useCallback(
    async (level: TrustLevel): Promise<void> => {
      if (committingRef.current) return;
      committingRef.current = true;
      setIsCommitting(true);
      try {
        const result = await commitTrustLevel(level);
        if (!mountedRef.current) return;
        if (!result.success) {
          reportError(
            addItem,
            getTrustCommitErrorMessage(
              result.phase,
              result.error,
              result.rollbackSucceeded,
            ),
          );
          return;
        }
        const changed = level !== pendingTrustLevel;
        reportCommitOutcome(addItem, targetPath, level, changed, isTargetCwd);
        if (!isTargetCwd) {
          setTargetPath(workingDirectory);
          setFormOrigin('root');
          setView('rules');
          return;
        }
        if (changed) setView('updated');
        else onExit();
      } catch (error) {
        if (!mountedRef.current) return;
        reportError(addItem, getTrustCommitErrorMessage('live', error, false));
      } finally {
        committingRef.current = false;
        if (mountedRef.current) setIsCommitting(false);
      }
    },
    [
      addItem,
      commitTrustLevel,
      committingRef,
      isTargetCwd,
      mountedRef,
      onExit,
      pendingTrustLevel,
      setFormOrigin,
      setIsCommitting,
      setTargetPath,
      setView,
      targetPath,
      workingDirectory,
    ],
  );
}

interface ViewState {
  view: TrustDialogView;
  setView: React.Dispatch<React.SetStateAction<TrustDialogView>>;
  formOrigin: FormOrigin;
  setFormOrigin: React.Dispatch<React.SetStateAction<FormOrigin>>;
  pathDraft: string;
  setPathDraft: React.Dispatch<React.SetStateAction<string>>;
  pathError: string | null;
  setPathError: React.Dispatch<React.SetStateAction<string | null>>;
}

function useViewState(): ViewState {
  const [view, setView] = useState<TrustDialogView>('form');
  const [formOrigin, setFormOrigin] = useState<FormOrigin>('root');
  const [pathDraft, setPathDraft] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  return {
    view,
    setView,
    formOrigin,
    setFormOrigin,
    pathDraft,
    setPathDraft,
    pathError,
    setPathError,
  };
}

interface NavigationActions {
  submitPath: () => void;
  selectRule: (rulePath: string) => void;
  removeRule: () => Promise<void>;
  handleEscape: () => void;
}

/** Navigation between the dialog views, including Escape's step-back rules. */
function useNavigationActions(
  trust: UsePermissionsModifyTrustReturn,
  viewState: ViewState,
  addItem: UseHistoryManagerReturn['addItem'],
  onExit: () => void,
  mountedRef: React.MutableRefObject<boolean>,
  committingRef: React.MutableRefObject<boolean>,
): NavigationActions {
  const { setTargetPath, workingDirectory, targetPath, removeTrustRule } =
    trust;
  const { setView, setFormOrigin, pathDraft, setPathError } = viewState;

  const submitPath = useCallback((): void => {
    // Every entry point that can change the active target takes the same
    // in-flight lock, so a write can never land against a path the user has
    // already navigated away from.
    if (committingRef.current) return;
    const resolved = resolveTrustDirectory(pathDraft, workingDirectory);
    if (!resolved.ok) {
      setPathError(getTrustPathProblemMessage(resolved.problem));
      return;
    }
    setPathError(null);
    setTargetPath(resolved.normalizedPath);
    setFormOrigin('root');
    setView('form');
  }, [
    pathDraft,
    workingDirectory,
    setPathError,
    setTargetPath,
    setFormOrigin,
    setView,
    committingRef,
  ]);

  const selectRule = useCallback(
    (rulePath: string): void => {
      if (committingRef.current) return;
      setTargetPath(rulePath);
      setFormOrigin('rules');
      setView('form');
    },
    [setTargetPath, setFormOrigin, setView, committingRef],
  );

  const removeRule = useCallback(async (): Promise<void> => {
    const result = await removeTrustRule(targetPath);
    if (!mountedRef.current) return;
    if (!result.success) {
      reportError(
        addItem,
        `Failed to remove the trust rule: ${describeError(result.error)}`,
      );
      return;
    }
    reportInfo(addItem, `Removed the trust rule for ${targetPath}.`);
    setTargetPath(workingDirectory);
    setFormOrigin('root');
    setView('rules');
  }, [
    addItem,
    mountedRef,
    removeTrustRule,
    setFormOrigin,
    setTargetPath,
    setView,
    targetPath,
    workingDirectory,
  ]);

  const handleEscape = useEscapeHandler(
    trust,
    viewState,
    onExit,
    committingRef,
  );

  return { submitPath, selectRule, removeRule, handleEscape };
}

/**
 * Escape steps back exactly one view: out of a sub-view to the form, out of a
 * rules-originated form back to the list, off a non-cwd form back to the
 * working directory, and only then out of the dialog entirely.
 */
function useEscapeHandler(
  trust: UsePermissionsModifyTrustReturn,
  viewState: ViewState,
  onExit: () => void,
  committingRef: React.MutableRefObject<boolean>,
): () => void {
  const { setTargetPath, workingDirectory, targetPath } = trust;
  const { view, formOrigin, setView, setFormOrigin } = viewState;
  return useCallback((): void => {
    // Escape takes the in-flight lock like every other navigation, so a
    // completing write cannot publish its view onto a screen the user stepped
    // back from.
    if (committingRef.current) return;
    if (view === 'path-entry' || view === 'rules') {
      setView('form');
      return;
    }
    if (formOrigin === 'rules') {
      setTargetPath(workingDirectory);
      setFormOrigin('root');
      setView('rules');
      return;
    }
    if (targetPath !== workingDirectory) {
      setTargetPath(workingDirectory);
      return;
    }
    onExit();
  }, [
    view,
    formOrigin,
    targetPath,
    onExit,
    setTargetPath,
    setFormOrigin,
    setView,
    workingDirectory,
    committingRef,
  ]);
}

interface TrustFormDisplay {
  currentTrustLevel: TrustLevel | undefined;
  effectiveTrustDisplay: string;
  warningMessage: string | null;
  getDisplayText: (level: TrustLevel | undefined) => string;
  options: Array<RadioSelectItem<TrustFormChoice>>;
  initialIndex: number;
}

/** Derives everything the trust form renders for the active target path. */
function useTrustFormDisplay(
  trust: UsePermissionsModifyTrustReturn,
): TrustFormDisplay {
  const {
    pendingTrustLevel,
    effectiveLocalTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    committedTrustLevel,
    effectiveTrust,
    targetPath,
    trustRules,
    parentFolderName,
  } = trust;
  const options = useMemo(
    () =>
      buildTrustFormOptions(path.basename(targetPath), parentFolderName, {
        hasDirectRule: pendingTrustLevel !== undefined,
        ruleCount: trustRules.length,
      }),
    [targetPath, parentFolderName, pendingTrustLevel, trustRules.length],
  );
  const initialIndex = useMemo(
    () =>
      findInitialTrustOptionIndex(
        options,
        pendingTrustLevel ?? effectiveLocalTrustLevel,
      ),
    [options, pendingTrustLevel, effectiveLocalTrustLevel],
  );
  const getDisplayText = useCallback(
    (level: TrustLevel | undefined): string =>
      getTrustLevelDisplay(level, isIdeTrusted, isParentTrusted),
    [isIdeTrusted, isParentTrusted],
  );
  return {
    currentTrustLevel: effectiveLocalTrustLevel,
    effectiveTrustDisplay: getTrustUpdateDisplay(
      committedTrustLevel,
      effectiveTrust,
      isIdeTrusted,
      isParentTrusted,
    ).effectiveNow,
    warningMessage: getWarningMessage(
      isIdeTrusted,
      isParentTrusted,
      effectiveLocalTrustLevel,
    ),
    getDisplayText,
    options,
    initialIndex,
  };
}

/**
 * Runs a rule removal under the same in-flight lock a commit takes, so the form
 * stays disabled and Escape is ignored until the write lands.
 *
 * The catch is the dialog's event boundary: the component dispatches selections
 * with `void`, so anything escaping here would become an unhandled rejection
 * that the user never sees.
 */
function useLockedRemoval({
  removeRule,
  addItem,
  setIsCommitting,
  committingRef,
  mountedRef,
}: {
  removeRule: () => Promise<void>;
  addItem: UseHistoryManagerReturn['addItem'];
  setIsCommitting: React.Dispatch<React.SetStateAction<boolean>>;
  committingRef: React.MutableRefObject<boolean>;
  mountedRef: React.MutableRefObject<boolean>;
}): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    committingRef.current = true;
    setIsCommitting(true);
    try {
      await removeRule();
    } catch (error) {
      if (mountedRef.current) {
        reportError(
          addItem,
          `Failed to remove the trust rule: ${describeError(error)}`,
        );
      }
    } finally {
      committingRef.current = false;
      if (mountedRef.current) setIsCommitting(false);
    }
  }, [addItem, removeRule, setIsCommitting, committingRef, mountedRef]);
}

/** Dispatches the non-trust-level entries of the trust form. */
function useFormActionRunner(
  viewState: ViewState,
  runLockedRemoval: () => Promise<void>,
): (action: TrustFormAction) => Promise<void> {
  const { setPathDraft, setPathError, setView } = viewState;
  return useCallback(
    async (action: TrustFormAction): Promise<void> => {
      switch (action) {
        case TrustFormAction.ADD_FOLDER:
          setPathDraft('');
          setPathError(null);
          setView('path-entry');
          break;
        case TrustFormAction.MANAGE_RULES:
          setView('rules');
          break;
        case TrustFormAction.REMOVE_RULE:
          await runLockedRemoval();
          break;
        default: {
          // Compile-time exhaustiveness: a new TrustFormAction fails to build
          // here rather than silently falling into one of the branches above.
          const unhandled: never = action;
          throw new Error(`Unhandled trust form action: ${String(unhandled)}`);
        }
      }
    },
    [runLockedRemoval, setPathDraft, setPathError, setView],
  );
}

export interface PermissionsTrustDialogFlow {
  view: TrustDialogView;
  targetPath: string;
  isTargetCwd: boolean;
  workingDirectory: string;
  currentTrustLevel: TrustLevel | undefined;
  committedTrustLevel: TrustLevel | undefined;
  effectiveTrustDisplay: string;
  warningMessage: string | null;
  getDisplayText: (level: TrustLevel | undefined) => string;
  options: Array<RadioSelectItem<TrustFormChoice>>;
  initialIndex: number;
  trustRules: UsePermissionsModifyTrustReturn['trustRules'];
  pathDraft: string;
  setPathDraft: (value: string) => void;
  pathError: string | null;
  isCommitting: boolean;
  isCommitPending: () => boolean;
  selectChoice: (choice: TrustFormChoice) => Promise<void>;
  submitPath: () => void;
  selectRule: (rulePath: string) => void;
  handleEscape: () => void;
}

/**
 * View-state machine for the permissions dialog.
 *
 * Kept separate from the presentational component so the navigation and commit
 * behavior can be exercised directly, and so the component stays a thin render
 * of whichever view is active.
 */
export function usePermissionsTrustDialogFlow(
  onExit: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
  config?: PermissionsTrustRuntime,
): PermissionsTrustDialogFlow {
  const trust = usePermissionsModifyTrust(config);
  const viewState = useViewState();
  const [isCommitting, setIsCommitting] = useState(false);
  const committingRef = useRef(false);
  const mountedRef = useMountedRef();
  const { view, pathDraft, setPathDraft, pathError } = viewState;

  const commitLevel = useCommitLevel({
    trust,
    addItem,
    onExit,
    setView: viewState.setView,
    setFormOrigin: viewState.setFormOrigin,
    setIsCommitting,
    committingRef,
    mountedRef,
  });
  const { submitPath, selectRule, removeRule, handleEscape } =
    useNavigationActions(
      trust,
      viewState,
      addItem,
      onExit,
      mountedRef,
      committingRef,
    );

  const runLockedRemoval = useLockedRemoval({
    removeRule,
    addItem,
    setIsCommitting,
    committingRef,
    mountedRef,
  });

  const runAction = useFormActionRunner(viewState, runLockedRemoval);

  const selectChoice = useCallback(
    async (choice: TrustFormChoice): Promise<void> => {
      // A write is in flight; ignore further selections so a late-resolving
      // commit cannot overwrite a view the user navigated to in the meantime.
      if (committingRef.current) return;
      if (isTrustFormAction(choice)) await runAction(choice);
      else if (isTrustLevel(choice)) await commitLevel(choice);
    },
    [commitLevel, runAction, committingRef],
  );

  const display = useTrustFormDisplay(trust);

  return {
    ...display,
    view,
    targetPath: trust.targetPath,
    isTargetCwd: trust.isTargetCwd,
    workingDirectory: trust.workingDirectory,
    committedTrustLevel: trust.committedTrustLevel,
    trustRules: trust.trustRules,
    pathDraft,
    setPathDraft,
    pathError,
    isCommitting,
    isCommitPending: () => committingRef.current,
    selectChoice,
    submitPath,
    selectRule,
    handleEscape,
  };
}
