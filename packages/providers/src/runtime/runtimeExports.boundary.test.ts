/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC4
 *
 * Boundary case: the providers package no longer holds agent-owned factories
 * in mutable state, so its public runtime surface must not export any
 * agent-runtime factory registration seam. The banned shape is matched
 * structurally (registration/reset/attachment of agent runtime factories)
 * rather than by literal name so reintroduced variants also fail.
 *
 * RED basis (main @ 5bedbd238): the public runtime barrel re-exported the
 * registration/reset functions and the bindings type.
 */

import { describe, it, expect } from 'bun:test';
// Read from the public barrels because the retired './runtime.js' entry and
// its `src/runtime/index.ts` barrel were deleted by the #2616 migration.
import * as providerApi from '../index.js';
import * as compositionApi from '../composition/index.js';

const surface = { ...providerApi, ...compositionApi };

/** Any export whose name registers, resets, or attaches agent runtime factories. */
const AGENT_FACTORY_SEAM_PATTERN =
  /(register|reset|attach)AgentRuntime|AgentRuntimeFactor(y|ies)/;

describe('providers runtime export surface @plan:ISSUE-3222 @requirement:REQ-3222-AC4', () => {
  it('exports no agent-runtime factory registration seam @requirement:REQ-3222-AC4 @scenario:deleted-seam @given:the public runtime barrel @when:its export shape is inspected @then:no export name matches the registration/reset/attach agent-runtime-factory seam pattern', () => {
    const seamExports = Object.keys(surface).filter((name) =>
      AGENT_FACTORY_SEAM_PATTERN.test(name),
    );
    expect(seamExports).toStrictEqual([]);
  });
});
