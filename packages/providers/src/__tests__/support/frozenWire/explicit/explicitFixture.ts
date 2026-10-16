/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: fixtures of the named counterexamples. One file per
 * group, `fixtures/frozen-wire/counterexamples-<group>.json`, mapping case
 * name to the observation of today's code. Regenerated with the same switch
 * as the frozen corpus (`FROZEN_WIRE_CORPUS_UPDATE=1`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  encodeJson,
  fixturePath,
  formatFixtureFiles,
} from '../frozenFixture.js';
import type { Observation } from './explicitCase.js';

export interface ExplicitFixture {
  readonly group: string;
  readonly description: string;
  readonly cases: Readonly<Record<string, Observation | undefined>>;
}

function path(group: string): string {
  return fixturePath(`counterexamples-${group}`);
}

export function readExplicitFixture(group: string): ExplicitFixture {
  if (!existsSync(path(group))) {
    throw new Error(
      `missing counterexample fixture ${path(group)}; regenerate deliberately with FROZEN_WIRE_CORPUS_UPDATE=1`,
    );
  }
  const fixture: ExplicitFixture = JSON.parse(
    readFileSync(path(group), 'utf8'),
  );
  return fixture;
}

export function writeExplicitFixture(fixture: ExplicitFixture): void {
  mkdirSync(dirname(path(fixture.group)), { recursive: true });
  writeFileSync(path(fixture.group), `${encodeJson(fixture, 2)}\n`);
  formatFixtureFiles([path(fixture.group)]);
}
