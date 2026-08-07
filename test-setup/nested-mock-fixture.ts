/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Fixture whose only export is an object, so mocks of it nest one level. */
export default {
  nested: (): string => 'real',
};
