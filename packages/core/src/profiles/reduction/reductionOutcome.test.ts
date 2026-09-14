/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { toDraftIdentity } from './reductionOutcome.js';
import type { WorkingProfileIdentity } from '../contracts/profileState.js';

const stat = { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 } as const;

const saved = (): WorkingProfileIdentity => ({
  kind: 'saved',
  name: 'work',
  source: { ...stat },
});

describe('toDraftIdentity', () => {
  it('converts a saved identity to a draft with derivedFrom', () => {
    const result = toDraftIdentity(saved());
    expect(result).toStrictEqual({
      kind: 'draft',
      derivedFrom: {
        name: 'work',
        source: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 },
      },
    });
  });

  it('keeps a draft with derivedFrom unchanged', () => {
    const draft: WorkingProfileIdentity = {
      kind: 'draft',
      derivedFrom: { name: 'work', source: { ...stat } },
    };
    expect(toDraftIdentity(draft)).toBe(draft);
  });

  it('keeps a bare draft bare', () => {
    const draft: WorkingProfileIdentity = { kind: 'draft' };
    expect(toDraftIdentity(draft)).toBe(draft);
  });
});
