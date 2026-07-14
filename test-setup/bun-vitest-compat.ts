/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { strict as assert } from 'node:assert';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it as bunIt,
  mock,
  test,
  vi as bunVi,
} from 'bun:test';
import { viAugmentations } from './augment-bun-vi.js';

const polyfilledVi = {
  ...bunVi,
  ...viAugmentations,
};

type TestFn = typeof bunIt & {
  runIf: (condition: boolean) => typeof bunIt;
};

const augmentedIt = bunIt.bind(undefined) as TestFn;
Object.assign(augmentedIt, {
  skip: bunIt.skip,
  only: bunIt.only,
  todo: bunIt.todo,
  runIf: (condition: boolean): typeof bunIt => (condition ? bunIt : bunIt.skip),
});

const unavailableTypeExport = Object.freeze({});

const vitestShim = {
  describe,
  it: augmentedIt,
  test,
  expect,
  vi: polyfilledVi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  Mock: unavailableTypeExport,
  MockInstance: unavailableTypeExport,
  Mocked: unavailableTypeExport,
  assert,
  expectTypeOf,
};

mock.module('vitest', () => vitestShim);
