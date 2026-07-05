/**
 * Guard test: asserts the runtime export name sets of the llm-types barrel
 * (`./index.js`) and the IContent barrel (`../services/history/IContent.js`)
 * are disjoint. TypeScript's `export *` silently drops ambiguous exports on
 * name clash without erroring at the barrel site — the ambiguity only surfaces
 * as a confusing error at downstream import sites. This test catches any
 * future runtime name collision early so the `export *` overlap in
 * `packages/core/src/index.ts` stays safe.
 *
 * Note: type-only re-exports do not appear as runtime keys, so only runtime
 * value symbols (functions, constants, classes) are compared.
 */

import { describe, expect, it } from 'vitest';
import * as llmTypes from './index.js';
import * as icontent from '../services/history/IContent.js';

describe('llm-types / IContent barrel runtime collision guard', () => {
  it('runtime export name sets are disjoint (no name clashes)', () => {
    const llmTypesKeys = new Set(Object.keys(llmTypes));
    const icontentKeys = new Set(Object.keys(icontent));

    // Sanity: ensure both barrels actually expose runtime symbols,
    // otherwise the disjointness assertion would pass trivially.
    expect(llmTypesKeys.size).toBeGreaterThan(0);
    expect(icontentKeys.size).toBeGreaterThan(0);

    const intersection = [...llmTypesKeys].filter((k) => icontentKeys.has(k));
    expect(intersection).toStrictEqual([]);
  });
});
