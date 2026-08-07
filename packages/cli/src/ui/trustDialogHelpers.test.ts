/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { TrustLevel } from '../config/trustedFolders.js';
import {
  FolderTrustChoice,
  buildTrustOptions,
  getLocalTrustLevelDisplay,
  getTrustLevelDisplay,
  getWarningMessage,
  getTrustUpdateDisplay,
  getTrustCommitErrorMessage,
  shouldDismissTrustDialog,
  buildTrustLevelOptions,
  combineTrustUpdateFailure,
  findInitialTrustOptionIndex,
  buildTrustFormOptions,
  buildTrustRuleOptions,
  isTrustFormAction,
  TrustFormAction,
} from './trustDialogHelpers.js';

describe('trustDialogHelpers', () => {
  describe('buildTrustOptions', () => {
    it('produces radio items with unique keys for the folder trust dialog', () => {
      const options = buildTrustOptions('project', 'workspace');
      expect(options).toHaveLength(3);
      expect(options[0].value).toBe(FolderTrustChoice.TRUST_FOLDER);
      expect(options[0].label).toBe('Trust folder (project)');
      expect(options[1].value).toBe(FolderTrustChoice.TRUST_PARENT);
      expect(options[1].label).toBe('Trust parent folder (workspace)');
      expect(options[2].value).toBe(FolderTrustChoice.DO_NOT_TRUST);
      expect(options[2].label).toBe("Don't trust");
      const keys = options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('uses stable semantic keys that are independent of display labels', () => {
      const first = buildTrustOptions('folder', 'parent');
      const renamed = buildTrustOptions('renamed', 'ancestor');

      expect(first.map((option) => option.key)).toStrictEqual(
        renamed.map((option) => option.key),
      );
      expect(first.map((option) => option.key)).toStrictEqual(
        first.map((option) => option.value),
      );
    });
  });

  describe('getLocalTrustLevelDisplay', () => {
    it('displays each trust level', () => {
      expect(getLocalTrustLevelDisplay(TrustLevel.TRUST_FOLDER)).toBe(
        'Trusted',
      );
      expect(getLocalTrustLevelDisplay(TrustLevel.TRUST_PARENT)).toBe(
        'Trust parent',
      );
      expect(getLocalTrustLevelDisplay(TrustLevel.DO_NOT_TRUST)).toBe(
        'Not trusted',
      );
      expect(getLocalTrustLevelDisplay(undefined)).toBe('Not set');
    });
  });

  describe('getTrustLevelDisplay', () => {
    it('represents an IDE false override', () => {
      expect(getTrustLevelDisplay(TrustLevel.TRUST_FOLDER, false, false)).toBe(
        'Not trusted (via IDE)',
      );
    });

    it('represents an IDE true override', () => {
      expect(getTrustLevelDisplay(TrustLevel.TRUST_FOLDER, true, false)).toBe(
        'Trusted (via IDE)',
      );
    });

    it('represents inherited DO_NOT_TRUST as inherited untrusted', () => {
      expect(
        getTrustLevelDisplay(TrustLevel.DO_NOT_TRUST, undefined, true),
      ).toBe('Not trusted (via parent folder)');
    });

    it('represents inherited trust when no direct trust level is set', () => {
      expect(getTrustLevelDisplay(undefined, undefined, true)).toBe(
        'Trusted (via parent folder)',
      );
    });

    it.each([
      [TrustLevel.TRUST_PARENT, undefined, false, 'Trust parent'],
      [
        TrustLevel.TRUST_PARENT,
        undefined,
        true,
        'Trust parent (via parent folder)',
      ],
      [TrustLevel.TRUST_PARENT, true, true, 'Trusted (via IDE)'],
      [TrustLevel.TRUST_PARENT, false, true, 'Not trusted (via IDE)'],
      [TrustLevel.DO_NOT_TRUST, true, true, 'Trusted (via IDE)'],
      [TrustLevel.DO_NOT_TRUST, false, true, 'Not trusted (via IDE)'],
    ] as const)(
      'displays %s with IDE trust %s and inherited provenance %s',
      (level, ideTrust, inheritedTrust, expected) => {
        expect(getTrustLevelDisplay(level, ideTrust, inheritedTrust)).toBe(
          expected,
        );
      },
    );
  });

  describe('getWarningMessage', () => {
    it('warns about IDE trust override', () => {
      expect(getWarningMessage(false, undefined, undefined)).toContain(
        'not trusted via your IDE settings',
      );
      expect(getWarningMessage(true, undefined, undefined)).toContain(
        'trusted via your IDE settings',
      );
    });

    it('warns about inherited parent distrust', () => {
      const msg = getWarningMessage(undefined, true, TrustLevel.DO_NOT_TRUST);
      expect(msg).toContain('a parent folder rule denies trust');
    });

    it('returns null when no override applies', () => {
      expect(getWarningMessage(undefined, undefined, undefined)).toBeNull();
    });
  });

  describe('getTrustUpdateDisplay', () => {
    it('distinguishes a saved local fallback from the live IDE override', () => {
      expect(
        getTrustUpdateDisplay(TrustLevel.TRUST_FOLDER, false, false, false),
      ).toStrictEqual({
        savedLocalFallback: 'Trusted',
        effectiveNow: 'Not trusted (via IDE)',
      });
    });

    it('preserves inherited parent provenance in the live display', () => {
      expect(
        getTrustUpdateDisplay(TrustLevel.TRUST_PARENT, true, undefined, true),
      ).toStrictEqual({
        savedLocalFallback: 'Trust parent',
        effectiveNow: 'Trusted (via parent folder)',
      });
    });
  });

  describe('combineTrustUpdateFailure', () => {
    it('retains the original error when rollback succeeds', () => {
      const error = new Error('update failed');

      expect(
        combineTrustUpdateFailure(error, [], 'rollback failed'),
      ).toStrictEqual({
        error,
        rollbackSucceeded: true,
      });
    });

    it('aggregates the update and every rollback failure', () => {
      const error = new Error('update failed');
      const rollbackFailure = new Error('restore failed');

      const result = combineTrustUpdateFailure(
        error,
        [rollbackFailure],
        'rollback failed',
      );

      expect(result.rollbackSucceeded).toBe(false);
      expect(result.error).toMatchObject({
        message: 'rollback failed',
        errors: [error, rollbackFailure],
      });
    });
  });

  describe('getTrustCommitErrorMessage', () => {
    it('reports a live failure with rollback context', () => {
      expect(
        getTrustCommitErrorMessage('live', new Error('live update failed')),
      ).toBe(
        'Trust settings could not be applied live, so the saved setting was restored: live update failed',
      );
    });

    it('reports a persistence failure', () => {
      expect(
        getTrustCommitErrorMessage('persistence', new Error('disk full')),
      ).toBe('Failed to save trust settings: disk full');
    });

    it('flattens nested transition and rollback failures without claiming restoration', () => {
      const error = new AggregateError(
        [
          new AggregateError(
            [new Error('disconnect failed'), new Error('refresh failed')],
            'transition failed',
          ),
          new Error('saved rollback failed'),
          new AggregateError(
            [new Error('policy rollback failed')],
            'live rollback failed',
          ),
        ],
        'Trust update and rollback failed',
      );

      const message = getTrustCommitErrorMessage('live', error, false);

      expect(message).toContain('disconnect failed');
      expect(message).toContain('refresh failed');
      expect(message).toContain('saved rollback failed');
      expect(message).toContain('policy rollback failed');
      expect(message).not.toMatch(/setting was restored/i);
    });
  });

  describe('shouldDismissTrustDialog', () => {
    it('requires Enter to dismiss the updated prompt while preserving Escape', () => {
      expect([
        shouldDismissTrustDialog(true, 'x'),
        shouldDismissTrustDialog(true, 'return'),
        shouldDismissTrustDialog(false, 'escape'),
      ]).toStrictEqual([false, true, true]);
    });

    it('does not dismiss on return when the updated prompt is not shown', () => {
      expect(shouldDismissTrustDialog(false, 'return')).toBe(false);
    });
  });

  describe('buildTrustLevelOptions', () => {
    it('builds radio items for the modify-trust dialog', () => {
      const options = buildTrustLevelOptions('project', 'workspace');
      expect(options).toStrictEqual([
        {
          key: TrustLevel.TRUST_FOLDER,
          label: 'Trust folder (project)',
          value: TrustLevel.TRUST_FOLDER,
        },
        {
          key: TrustLevel.TRUST_PARENT,
          label: 'Trust parent folder (workspace)',
          value: TrustLevel.TRUST_PARENT,
        },
        {
          key: TrustLevel.DO_NOT_TRUST,
          label: "Don't trust",
          value: TrustLevel.DO_NOT_TRUST,
        },
      ]);
    });
  });

  describe('findInitialTrustOptionIndex', () => {
    it('finds the index of the current trust level', () => {
      const options = buildTrustLevelOptions('project', 'workspace');
      expect(
        findInitialTrustOptionIndex(options, TrustLevel.TRUST_PARENT),
      ).toBe(1);
    });

    it('defaults to 0 when the current trust level is not found', () => {
      const options = buildTrustLevelOptions('project', 'workspace');
      expect(findInitialTrustOptionIndex(options, undefined)).toBe(0);
    });
  });

  describe('buildTrustFormOptions', () => {
    it('lists the three trust levels first so Enter still trusts the folder', () => {
      const options = buildTrustFormOptions('project', 'workspace', {
        hasDirectRule: false,
        ruleCount: 0,
      });

      expect(options.slice(0, 3).map((option) => option.value)).toStrictEqual([
        TrustLevel.TRUST_FOLDER,
        TrustLevel.TRUST_PARENT,
        TrustLevel.DO_NOT_TRUST,
      ]);
    });

    it('appends the add-folder and manage-rules actions', () => {
      const options = buildTrustFormOptions('project', 'workspace', {
        hasDirectRule: false,
        ruleCount: 4,
      });

      expect(options.map((option) => option.value)).toStrictEqual([
        TrustLevel.TRUST_FOLDER,
        TrustLevel.TRUST_PARENT,
        TrustLevel.DO_NOT_TRUST,
        TrustFormAction.ADD_FOLDER,
        TrustFormAction.MANAGE_RULES,
      ]);
    });

    it('reports the rule count in the manage-rules label', () => {
      const options = buildTrustFormOptions('project', 'workspace', {
        hasDirectRule: false,
        ruleCount: 7,
      });

      const manage = options.find(
        (option) => option.value === TrustFormAction.MANAGE_RULES,
      );
      // Exact match: a substring check would also accept "(17)" or a label that
      // lost its parentheses.
      expect(manage?.label).toBe('Manage existing rules (7)…');
    });

    it('offers removal only when the folder has a direct rule', () => {
      const withRule = buildTrustFormOptions('project', 'workspace', {
        hasDirectRule: true,
        ruleCount: 1,
      });
      const withoutRule = buildTrustFormOptions('project', 'workspace', {
        hasDirectRule: false,
        ruleCount: 1,
      });

      expect(
        withRule.some((option) => option.value === TrustFormAction.REMOVE_RULE),
      ).toBe(true);
      expect(
        withoutRule.some(
          (option) => option.value === TrustFormAction.REMOVE_RULE,
        ),
      ).toBe(false);
    });
  });

  describe('isTrustFormAction', () => {
    it('accepts every form action', () => {
      for (const action of Object.values(TrustFormAction)) {
        expect(isTrustFormAction(action)).toBe(true);
      }
    });

    it('rejects every trust level', () => {
      for (const level of Object.values(TrustLevel)) {
        expect(isTrustFormAction(level)).toBe(false);
      }
    });
  });

  describe('buildTrustRuleOptions', () => {
    it('uses the rule path as the selectable value', () => {
      const options = buildTrustRuleOptions([
        { path: '/a/b', trustLevel: TrustLevel.TRUST_FOLDER },
      ]);

      expect(options[0].value).toBe('/a/b');
    });

    it('states the trust level before the path so a long path cannot truncate it away', () => {
      const deepPath = `/${'nested/'.repeat(40)}folder`;
      const options = buildTrustRuleOptions([
        { path: deepPath, trustLevel: TrustLevel.DO_NOT_TRUST },
      ]);

      expect(options[0].label.startsWith('[Not trusted]')).toBe(true);
      expect(options[0].label).toContain(deepPath);
    });

    it('returns no options when nothing is configured', () => {
      // The state the manage-rules view opens in before any rule exists.
      expect(buildTrustRuleOptions([])).toStrictEqual([]);
    });

    it('returns one option per rule', () => {
      const options = buildTrustRuleOptions([
        { path: '/a', trustLevel: TrustLevel.TRUST_FOLDER },
        { path: '/b', trustLevel: TrustLevel.DO_NOT_TRUST },
      ]);

      expect(options).toHaveLength(2);
    });
  });
});
