/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { purgeBoundaryCases } from './support/frozenWire/explicit/purgeBoundaryCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('purge-boundary', purgeBoundaryCases());
