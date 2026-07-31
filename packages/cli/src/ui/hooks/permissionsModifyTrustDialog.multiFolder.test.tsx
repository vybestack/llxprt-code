/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderHook } from '../../test-utils/render.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import { MessageType } from '../types.js';
import { TrustFormAction } from '../trustDialogHelpers.js';
import type { PermissionsTrustRuntime } from './usePermissionsModifyTrust.js';
import { usePermissionsTrustDialogFlow } from './usePermissionsTrustDialogFlow.js';

const mockedSetValue = vi.hoisted(() => vi.fn());
const mockedDeleteRuleByKey = vi.hoisted(() => vi.fn());
const mockedSnapshotValue = vi.hoisted(() => vi.fn());
const mockedRestoreSnapshot = vi.hoisted(() => vi.fn());
const mockedResolvePathTrust = vi.hoisted(() => vi.fn());
const mockedTrustedConfig = vi.hoisted<{
  value: Record<string, TrustLevel>;
}>(() => ({ value: {} }));

vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../config/trustedFolders.js')
  >('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      get rules() {
        return Object.entries(mockedTrustedConfig.value).map(
          ([rulePath, trustLevel]) => ({ path: rulePath, trustLevel }),
        );
      },
      setValue: mockedSetValue,
      deleteValue: vi.fn(),
      removeRule: mockedDeleteRuleByKey,
      getValue: (folderPath: string) => mockedTrustedConfig.value[folderPath],
      snapshotValue: mockedSnapshotValue,
      restoreSnapshot: mockedRestoreSnapshot,
      user: { path: '/mock/path', config: mockedTrustedConfig.value },
      errors: [],
      isPathTrusted: (folderPath: string) =>
        mockedResolvePathTrust(folderPath)?.trusted,
      resolvePathTrust: mockedResolvePathTrust,
    })),
  };
});

vi.mock('./useIdeTrustListener.js', () => ({
  useIdeTrustListener: () => ({ isIdeTrusted: undefined }),
}));

describe('permissions dialog multi-folder flow', () => {
  let tempRoot: string;
  let cwd: string;
  let otherFolder: string;
  let addItem: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let setTrustedFolderLive: ReturnType<typeof vi.fn>;
  let config: PermissionsTrustRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-perm-flow-')),
    );
    cwd = path.join(tempRoot, 'workspace');
    otherFolder = path.join(tempRoot, 'other-project');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(otherFolder, { recursive: true });

    mockedTrustedConfig.value = {};
    mockedSetValue.mockImplementation((folderPath, trustLevel) => {
      mockedTrustedConfig.value[folderPath] = trustLevel;
    });
    mockedDeleteRuleByKey.mockImplementation((ruleKey) => {
      delete mockedTrustedConfig.value[ruleKey];
    });
    mockedSnapshotValue.mockImplementation((folderPath) => ({
      canonicalPath: folderPath,
      entries: Object.entries(mockedTrustedConfig.value).filter(
        ([entryPath]) => entryPath === folderPath,
      ),
    }));
    mockedRestoreSnapshot.mockImplementation((snapshot) => {
      delete mockedTrustedConfig.value[snapshot.canonicalPath];
      for (const [folderPath, trustLevel] of snapshot.entries) {
        mockedTrustedConfig.value[folderPath] = trustLevel;
      }
    });
    mockedResolvePathTrust.mockReturnValue(undefined);

    addItem = vi.fn();
    onExit = vi.fn();
    setTrustedFolderLive = vi.fn();
    config = {
      setTrustedFolderLive,
      getWorkingDir: () => cwd,
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
    };
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const renderFlow = () =>
    renderHook(() => usePermissionsTrustDialogFlow(onExit, addItem, config));

  const labelsOf = (options: Array<{ label: string }>): string[] =>
    options.map((option) => option.label);

  it('C1: opens on the trust form targeting the working directory', () => {
    const { result } = renderFlow();

    expect(result.current.view).toBe('form');
    expect(result.current.targetPath).toBe(cwd);
    expect(result.current.isTargetCwd).toBe(true);
  });

  it('C1: the first option is still Trust folder so Enter keeps its meaning', async () => {
    const { result } = renderFlow();

    expect(result.current.options[0]?.value).toBe(TrustLevel.TRUST_FOLDER);
    expect(result.current.initialIndex).toBe(0);

    await act(async () => {
      await result.current.selectChoice(result.current.options[0].value);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(cwd, TrustLevel.TRUST_FOLDER);
  });

  it('C2: offers navigation entries for adding a folder and managing rules', () => {
    const { result } = renderFlow();

    const labels = labelsOf(result.current.options);
    expect(labels.some((label) => label.includes('Add another folder'))).toBe(
      true,
    );
    expect(
      labels.some((label) => label.includes('Manage existing rules')),
    ).toBe(true);
  });

  it('C3: submitting a valid directory retargets the form to that path', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    expect(result.current.view).toBe('path-entry');

    act(() => result.current.setPathDraft(otherFolder));
    act(() => result.current.submitPath());

    expect(result.current.view).toBe('form');
    expect(result.current.targetPath).toBe(otherFolder);
    expect(result.current.isTargetCwd).toBe(false);
  });

  it('C3: a trust level chosen after entering a path is saved for that path only', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(otherFolder));
    act(() => result.current.submitPath());

    await act(async () => {
      await result.current.selectChoice(TrustLevel.DO_NOT_TRUST);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      otherFolder,
      TrustLevel.DO_NOT_TRUST,
    );
    expect(mockedSetValue).toHaveBeenCalledTimes(1);
  });

  it('C3: a relative path is resolved against the working directory', async () => {
    fs.mkdirSync(path.join(cwd, 'nested'), { recursive: true });
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft('nested'));
    act(() => result.current.submitPath());

    expect(result.current.targetPath).toBe(path.join(cwd, 'nested'));
  });

  it('C3: a symlinked spelling resolves to the same folder the rule is stored under', async () => {
    const linkPath = path.join(tempRoot, 'other-link');
    fs.symlinkSync(otherFolder, linkPath, 'dir');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(linkPath));
    act(() => result.current.submitPath());

    // The store keys rules by canonical path, so the dialog must target the
    // canonical folder rather than the link, or the rule it writes would read
    // back as a different folder.
    expect(result.current.targetPath).toBe(otherFolder);

    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      otherFolder,
      TrustLevel.TRUST_FOLDER,
    );
  });

  it('C4: reports a path that does not exist and stays in the input', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(path.join(tempRoot, 'missing')));
    act(() => result.current.submitPath());

    expect(result.current.view).toBe('path-entry');
    expect(result.current.pathError).toBe('That folder does not exist.');
    expect(mockedSetValue).not.toHaveBeenCalled();
  });

  it('C4: reports a path that is a file rather than a directory', async () => {
    const filePath = path.join(tempRoot, 'a-file.txt');
    fs.writeFileSync(filePath, 'contents');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(filePath));
    act(() => result.current.submitPath());

    expect(result.current.view).toBe('path-entry');
    expect(result.current.pathError).toBe('That path is not a folder.');
  });

  it('C4: reports an unreadable folder distinctly from a missing one', async () => {
    const blocked = path.join(tempRoot, 'blocked');
    fs.mkdirSync(blocked);
    const target = path.join(blocked, 'inner');
    fs.mkdirSync(target);
    fs.chmodSync(blocked, 0o000);
    const { result } = renderFlow();

    try {
      await act(async () => {
        await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
      });
      act(() => result.current.setPathDraft(target));
      act(() => result.current.submitPath());

      // Saying "does not exist" here would send the user looking for a folder
      // that is in fact present but unreadable.
      expect(result.current.pathError).toBe('That folder cannot be read.');
    } finally {
      fs.chmodSync(blocked, 0o700);
    }
  });

  it('C5: reports an empty submission and stays in the input', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.submitPath());

    expect(result.current.view).toBe('path-entry');
    expect(result.current.pathError).toBe('Enter a folder path to continue.');
  });

  it('C6: lists every configured rule with its path and level', async () => {
    mockedTrustedConfig.value = {
      [otherFolder]: TrustLevel.DO_NOT_TRUST,
      [cwd]: TrustLevel.TRUST_FOLDER,
    };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });

    expect(result.current.view).toBe('rules');
    expect(result.current.trustRules).toStrictEqual([
      { path: otherFolder, trustLevel: TrustLevel.DO_NOT_TRUST },
      { path: cwd, trustLevel: TrustLevel.TRUST_FOLDER },
    ]);
  });

  it('C7: selecting a listed rule retargets the form to that rule path', async () => {
    mockedTrustedConfig.value = { [otherFolder]: TrustLevel.DO_NOT_TRUST };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.selectRule(otherFolder));

    expect(result.current.view).toBe('form');
    expect(result.current.targetPath).toBe(otherFolder);
    // The form must recompute for the new target, otherwise it would offer the
    // previous folder's actions — the selected rule is removable.
    expect(
      result.current.options.some(
        (option) => option.value === TrustFormAction.REMOVE_RULE,
      ),
    ).toBe(true);
  });

  it('C8: offers rule removal only when the active target has a direct rule', async () => {
    const withoutRule = renderFlow();
    expect(
      withoutRule.result.current.options.some(
        (option) => option.value === TrustFormAction.REMOVE_RULE,
      ),
    ).toBe(false);

    mockedTrustedConfig.value = { [cwd]: TrustLevel.TRUST_FOLDER };
    const withRule = renderFlow();
    expect(
      withRule.result.current.options.some(
        (option) => option.value === TrustFormAction.REMOVE_RULE,
      ),
    ).toBe(true);
  });

  it('C8: removing a rule deletes it and returns to the refreshed rules list', async () => {
    mockedTrustedConfig.value = { [otherFolder]: TrustLevel.TRUST_FOLDER };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.selectRule(otherFolder));
    await act(async () => {
      await result.current.selectChoice(TrustFormAction.REMOVE_RULE);
    });

    expect(mockedDeleteRuleByKey).toHaveBeenCalledWith(otherFolder);
    expect(result.current.view).toBe('rules');
    expect(result.current.trustRules).toStrictEqual([]);
  });

  it('C8: removing the working directory rule clears the removal option from the form', async () => {
    mockedTrustedConfig.value = { [cwd]: TrustLevel.TRUST_FOLDER };
    const { result } = renderFlow();

    expect(
      result.current.options.some(
        (option) => option.value === TrustFormAction.REMOVE_RULE,
      ),
    ).toBe(true);

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.REMOVE_RULE);
    });

    // The rule is gone, so the form must no longer offer to remove it. Asserted
    // directly after the removal so nothing else can influence the result.
    expect(
      result.current.options.some(
        (option) => option.value === TrustFormAction.REMOVE_RULE,
      ),
    ).toBe(false);
    expect(result.current.trustRules).toStrictEqual([]);
  });

  it('C10: reports a changed level when replacing an existing rule on the cwd', async () => {
    mockedTrustedConfig.value = { [cwd]: TrustLevel.DO_NOT_TRUST };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    // Replacing DO_NOT_TRUST with TRUST_FOLDER is a change, so the dialog must
    // show the updated prompt and say so rather than reporting it unchanged.
    expect(result.current.view).toBe('updated');
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('set to Trusted'),
      }),
      expect.any(Number),
    );
  });

  it('C10: reports an unchanged level when re-selecting the level already stored', async () => {
    mockedTrustedConfig.value = { [cwd]: TrustLevel.TRUST_FOLDER };
    const onExitLocal = vi.fn();
    onExit = onExitLocal;
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('unchanged'),
      }),
      expect.any(Number),
    );
    expect(onExitLocal).toHaveBeenCalledTimes(1);
  });

  it('C13: a navigation action is ignored while a commit is still in flight', async () => {
    let releaseCommit: (() => void) | undefined;
    setTrustedFolderLive.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCommit = () => resolve();
        }),
    );
    const { result } = renderFlow();

    let commit: Promise<void> | undefined;
    act(() => {
      commit = result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    expect(result.current.view).toBe('form');

    await act(async () => {
      releaseCommit?.();
      await commit;
    });

    expect(result.current.view).toBe('updated');
  });

  it('C9: committing a non-cwd change returns to the rules list for further edits', async () => {
    mockedTrustedConfig.value = { [otherFolder]: TrustLevel.DO_NOT_TRUST };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.selectRule(otherFolder));
    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(result.current.view).toBe('rules');
    expect(result.current.targetPath).toBe(cwd);
    expect(mockedTrustedConfig.value[otherFolder]).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    // The list the user lands back on must show the level just committed, not
    // the pre-commit snapshot.
    expect(result.current.trustRules).toStrictEqual([
      { path: otherFolder, trustLevel: TrustLevel.TRUST_FOLDER },
    ]);
  });

  it('C9: a non-cwd commit does not grant the session the target folder trust', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(otherFolder));
    act(() => result.current.submitPath());
    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    expect(setTrustedFolderLive).not.toHaveBeenCalledWith(true);
  });

  it('C10: committing a cwd change shows the trust-updated prompt', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(result.current.view).toBe('updated');
    expect(result.current.committedTrustLevel).toBe(TrustLevel.TRUST_FOLDER);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C11: Escape in the path input steps back to the trust form', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.handleEscape());

    expect(result.current.view).toBe('form');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C11: Escape in the rules list steps back to the trust form', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.handleEscape());

    expect(result.current.view).toBe('form');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C11: Escape on a form reached from the rules list returns to that list', async () => {
    mockedTrustedConfig.value = { [otherFolder]: TrustLevel.DO_NOT_TRUST };
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.selectRule(otherFolder));
    act(() => result.current.handleEscape());

    expect(result.current.view).toBe('rules');
    expect(result.current.targetPath).toBe(cwd);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C11: Escape on a form reached from path entry returns to the working directory', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.ADD_FOLDER);
    });
    act(() => result.current.setPathDraft(otherFolder));
    act(() => result.current.submitPath());
    act(() => result.current.handleEscape());

    expect(result.current.view).toBe('form');
    expect(result.current.targetPath).toBe(cwd);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C11: Escape on the working directory form exits the dialog', () => {
    const { result } = renderFlow();

    act(() => result.current.handleEscape());

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('C12: the displayed current level follows the active target path', async () => {
    mockedTrustedConfig.value = { [otherFolder]: TrustLevel.DO_NOT_TRUST };
    mockedResolvePathTrust.mockImplementation((folderPath: string) =>
      folderPath === otherFolder
        ? {
            rule: { path: otherFolder, trustLevel: TrustLevel.DO_NOT_TRUST },
            effectivePath: otherFolder,
            trusted: false,
            provenance: 'direct',
          }
        : undefined,
    );
    const { result } = renderFlow();

    expect(result.current.currentTrustLevel).toBeUndefined();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.MANAGE_RULES);
    });
    act(() => result.current.selectRule(otherFolder));

    expect(result.current.currentTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(
      result.current.getDisplayText(result.current.currentTrustLevel),
    ).toBe('Not trusted');
  });

  it('C13: a removal failure is reported and the dialog stays open', async () => {
    mockedTrustedConfig.value = { [cwd]: TrustLevel.TRUST_FOLDER };
    mockedDeleteRuleByKey.mockImplementation(() => {
      throw new Error('disk full');
    });
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustFormAction.REMOVE_RULE);
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining('disk full'),
      }),
      expect.any(Number),
    );
    expect(result.current.view).toBe('form');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('C13: a commit failure is reported and the dialog stays open', async () => {
    mockedSetValue.mockImplementation(() => {
      throw new Error('read-only filesystem');
    });
    const { result } = renderFlow();

    await act(async () => {
      await result.current.selectChoice(TrustLevel.TRUST_FOLDER);
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining('read-only filesystem'),
      }),
      expect.any(Number),
    );
    expect(result.current.view).toBe('form');
    expect(onExit).not.toHaveBeenCalled();
  });
});
