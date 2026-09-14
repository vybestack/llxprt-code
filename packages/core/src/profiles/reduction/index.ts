/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile reduction exports.
 *
 * Each command has a pure reducer plus any internal builder a sibling reuses
 * (buildLoadCandidate for startup, buildProviderCandidate for provider reset and
 * startup), so a caller can delegate without duplicating revision logic.
 */

export type { ConfiguredProfile } from './reduceModelCommand.js';
export { reduceProfileCommand } from './reduceProfileCommand.js';
export { reduceModelCommand } from './reduceModelCommand.js';
export { reduceProviderCommand } from './reduceProviderCommand.js';
export { buildProviderCandidate } from './reduceProviderCommand.js';
export { reduceLoadCommand } from './reduceLoadCommand.js';
export { buildLoadCandidate } from './reduceLoadCommand.js';
export type { LoadCandidate } from './reduceLoadCommand.js';
export { reduceSetupCommand } from './reduceSetupCommand.js';
export { reduceSetCommand } from './reduceSetCommand.js';
export { reduceSaveCommand } from './reduceSaveCommand.js';
export { reduceStartupCommand } from './reduceStartupCommand.js';
export type { ProfileReductionOutcome } from './reductionOutcome.js';
export { toDraftIdentity } from './reductionOutcome.js';
export type { ProfileReductionEnvironment } from './reductionEnvironment.js';
export { emptyReductionEnvironment } from './reductionEnvironment.js';
