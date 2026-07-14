/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
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
  findInitialTrustOptionIndex,
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

    it('warns about parent folder trust', () => {
      const msg = getWarningMessage(undefined, true, TrustLevel.DO_NOT_TRUST);
      expect(msg).toContain('local rule overrides the trusted parent folder');
    });

    it('returns null when no override applies', () => {
      expect(getWarningMessage(undefined, undefined, undefined)).toBeNull();
    });
  });

  describe('getTrustUpdateDisplay', () => {
    it('distinguishes a saved local fallback from the live IDE override', () => {
      expect(
        getTrustUpdateDisplay(TrustLevel.TRUST_FOLDER, false, false),
      ).toStrictEqual({
        savedLocalFallback: 'Trusted',
        effectiveNow: 'Not trusted (via IDE)',
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
      expect(options).toHaveLength(3);
      expect(options[0].value).toBe(TrustLevel.TRUST_FOLDER);
      expect(options[1].value).toBe(TrustLevel.TRUST_PARENT);
      expect(options[2].value).toBe(TrustLevel.DO_NOT_TRUST);
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
});
