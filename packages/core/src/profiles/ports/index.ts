/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile port exports.
 *
 * Ports are the boundaries the profiles tree depends on. They name what core needs
 * (repositories, credential resolvers, model catalogs, trust ceilings, runtime
 * factories, scheduler boundaries) without importing settings or providers, so implementations
 * can live outside core and still meet these shapes.
 */

export type { ProfileRepositoryPort } from './profileRepositoryPort.js';
export { ProfileRepositoryConflictError } from './profileRepositoryPort.js';
export type {
  CredentialBinding,
  CredentialSecret,
  CredentialResolverPort,
} from './credentialResolverPort.js';
export type { ProviderModelCatalogPort } from './providerCatalogPort.js';
export type { TrustToolEnvironmentPort } from './trustEnvironmentPort.js';
export type {
  EffectiveToolPolicy,
  ResolvedProfileSpec,
  ProfileRuntimeBinding,
  ProfileRuntimeFactoryPort,
} from './profileRuntimeFactoryPort.js';
export type {
  SafeBoundaryOutcome,
  SchedulerBoundaryPort,
} from './schedulerBoundaryPort.js';
