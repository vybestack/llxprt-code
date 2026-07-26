/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { extractSourceFacts } from '../../release-notes/provenance.js';
import type { ChangeEntry, EnrichedRef } from '../../release-notes/types.js';

function makeRef(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 42,
    title: 'Faster streaming responses',
    body: 'Users now receive responses without intermittent stalls.',
    labels: ['feature'],
    labelsTruncated: false,
    author: 'alice',
    isPr: false,
    userImpact: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 'ref:42',
    subject: 'feat: thing',
    hash: 'abc',
    author: 'dev',
    refs: [],
    enriched: [makeRef()],
    category: 'new',
    eligibleForHighlights: true,
    childHashes: [],
    sourceFacts: [],
    ...overrides,
  };
}

describe('extractUserImpact — adapter/provider/registry/parser/config mechanism rejection (Finding 2)', () => {
  // These adversarial tests guard against internal mechanism prose that
  // describes new adapters, provider registries, configuration parsers,
  // config loaders, and similar internal plumbing masquerading as
  // user-facing impact. Each sentence below MUST be rejected — it
  // describes an internal mechanism, not an explicit user actor,
  // capability, or observable outcome.

  it('rejects "new adapter" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Added a new adapter for the internal provider system.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "adapter registry" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The adapter registry was updated to support new entries.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "provider registry" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Implemented a provider registry for dynamic loading.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "new provider registry" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Created a new provider registry to manage internal components.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "configuration parser" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The configuration parser was rewritten for better performance.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "new parser" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'A new parser was added for the internal config format.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "adapter framework" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Built an adapter framework for extensible internal modules.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "internal mechanism" prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This change adds an internal mechanism for plugin loading.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "plumbing" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Updated the internal plumbing for the provider layer.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "under the hood" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Changes under the hood improve the build system reliability.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "config loader" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The config loader was refactored to reduce duplication.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "config layer" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The config layer was reorganized for internal consistency.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "config handler" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The config handler was extracted into a separate module.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "internal config" mechanism prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The internal config was updated to support new registry entries.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });
});

describe('extractUserImpact — weak signals alone are insufficient (Finding 2)', () => {
  // Words like "new", "option", "configuration", "cli", "setting", "flag"
  // describe WHAT changed but not WHO benefits or what the user OBSERVES.
  // These alone must NOT qualify as defensible user-facing impact. They
  // require an explicit user actor, capability phrase, or observable
  // outcome to form a valid impact statement.

  it('rejects a sentence with only "new" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Added a new internal module for the processing pipeline.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "option" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The option field was added to the internal data structure.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "configuration" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The configuration values were reorganized in the schema.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "cli" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The cli module was restructured for internal consistency.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "setting" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The setting object was updated in the internal registry.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "flag" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The flag variable was renamed in the module exports.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "command" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The command handler was refactored for the dispatcher pattern.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects a sentence with only "available" and no user actor/capability/observable', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The available endpoints were registered in the router.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it.each([
    'Refactor parser without changing behavior.',
    'Users receive the same output without any visible change.',
  ])('rejects explicit no-change prose: %s', (body) => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body })] }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects internal CI impact for maintainers', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({ body: 'This fixes CI failures for maintainers.' }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });
});

describe('extractUserImpact — weak signal + explicit actor/capability/observable is valid (Finding 2)', () => {
  // Weak signals ("new", "option", "configuration") DO qualify as valid
  // impact when combined with an explicit user actor ("users"), capability
  // phrase ("can now"), or observable outcome ("no longer"). The finding
  // requires preserving valid impact, not rejecting everything with a
  // weak signal word.

  it('accepts "new" + "users" (explicit actor)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users get a new option to control output format.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('new option');
  });

  it('accepts "configuration" + "can now" (capability)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Developers can now configure the retry behavior.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('configure');
  });

  it('accepts "cli" + "fixes" (observable outcome)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This fixes the cli crash on startup.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('cli crash');
  });

  it('accepts "setting" + "allows" (capability)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'A new setting allows users to control cache size.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('cache size');
  });

  it('accepts "flag" + "can use" (capability)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can use a flag to enable verbose output.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('verbose output');
  });

  it('accepts "command" + "can run" (capability)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can run the command to export session data.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('export session');
  });

  it('accepts "option" + "can select" (capability)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can select an option to change the theme.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('change the theme');
  });
});

describe('extractUserImpact — preserves valid impact with explicit actor/capability/observable (Finding 2)', () => {
  // These tests verify that genuine user-facing impact sentences — with
  // explicit user actors, capability phrases, or observable outcomes —
  // are preserved even when they happen to mention internal-sounding words.

  it.each([
    'Improves performance for large sessions.',
    'Enhances stability during startup.',
    'Users now receive better error messages.',
  ])('accepts directional impact with an observable subject: %s', (body) => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body })] }),
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toBe(body);
  });

  it.each([
    'Improves functionality.',
    'Improves features.',
    'Improves application behavior.',
  ])('rejects content-free directional claims: %s', (body) => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body })] }),
    );

    expect(facts).toEqual([]);
  });

  it('accepts genuine user impact with "users" actor', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users now experience faster response times.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('faster response');
  });

  it('accepts genuine capability "can now"', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'You can now pin a specific model version.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('pin a specific model');
  });

  it('accepts genuine observable outcome "no longer"', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The application no longer crashes on large inputs.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('no longer crashes');
  });

  it('accepts genuine observable outcome "fixes"', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This fixes a memory leak during long sessions.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('memory leak');
  });

  it('accepts genuine observable outcome "faster"', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Startup is now 3x faster for all users.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('3x faster');
  });

  it('accepts "developers" actor with capability', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Developers can now extend the tool with custom plugins.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('custom plugins');
  });

  it('accepts "config" when paired with a user capability phrase', () => {
    // "config" alone is a weak signal, but "can now configure" is a
    // capability phrase. Genuine user-facing config changes must survive.
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can now configure the output format via the config file.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('configure the output format');
  });

  it.each([
    'Users experience crashes on startup.',
    'Developers cannot load saved profiles.',
    'Customers see intermittent failures during login.',
    'The CLI is slower for users with large histories.',
  ])(
    'rejects negative problem statement without a directional resolution: %s',
    (body) => {
      const facts = extractSourceFacts(
        makeEntry({ enriched: [makeRef({ body })] }),
      );

      expect(facts).toEqual([]);
    },
  );

  it('rejects mechanism prose without a recognized impact signal', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The state machine enables users to resume sessions.',
          }),
        ],
      }),
    );

    expect(facts).toEqual([]);
  });

  it.each([
    'A new provider registry allows users to select providers.',
    'The configuration parser now gives users clearer errors.',
    'The adapter layer lets developers add custom providers.',
  ])(
    'accepts strong user impact even when mechanism wording is present: %s',
    (body) => {
      const facts = extractSourceFacts(
        makeEntry({ enriched: [makeRef({ body })] }),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]!.userImpact).toBe(body);
    },
  );

  it.each([
    'The refactor lets developers run tests faster.',
    'The CI build allows developers to run tests.',
    'Improved code quality.',
    'Safer release process.',
    'Cleaner implementation.',
    'Simpler control flow.',
    'Faster composition root initialization.',
    'Cleaner provider implementation.',
    'Improved provider abstraction.',
    'Safer configuration loading.',
    'Faster provider initialization.',
    'Cleaner provider wiring.',
  ])('rejects internal maintenance outcomes: %s', (body) => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body })] }),
    );

    expect(facts).toEqual([]);
  });

  it('retains directional resolution while excluding a mechanism title', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            title: 'State machine rewrite for session recovery',
            body: 'Users can now resume interrupted sessions.',
          }),
        ],
      }),
    );

    expect(facts).toEqual([
      expect.objectContaining({
        title: '',
        userImpact: 'Users can now resume interrupted sessions.',
      }),
    ]);
  });
});
