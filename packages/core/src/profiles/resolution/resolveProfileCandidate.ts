/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileDocument } from '../contracts/profileDocument.js';
import {
  isLoadBalancerProfileDocument,
  isStandardProfileDocument,
} from '../contracts/profileDocument.js';
import type {
  LoadBalancerProfileDocument,
  StandardProfileDocument,
} from '../contracts/profileDocument.js';
import type { CapturedStandardSource } from '../contracts/profileState.js';
import type { CredentialBinding } from '../ports/credentialResolverPort.js';
import type { ProfileRepositoryPort } from '../ports/profileRepositoryPort.js';
import type { ProviderModelCatalogPort } from '../ports/providerCatalogPort.js';
import type { ResolvedProfileSpec } from '../ports/profileRuntimeFactoryPort.js';
import type { TrustToolEnvironmentPort } from '../ports/trustEnvironmentPort.js';
import { deriveCredentialBindings } from './credentialBindings.js';
import { memberCredentialBindings } from './memberAuthResolution.js';
import {
  intersectPolicy,
  type PolicyCeiling,
  type PolicyExplanation,
  type ProfilePolicyIntent,
} from './policyIntersection.js';

/**
 * Input to candidate resolution: the document under consideration plus the policy intent
 * its effective profile is desired with.
 */
export interface ProfileCandidateResolutionInput {
  document: ProfileDocument;
  policyIntent: ProfilePolicyIntent;
}

/**
 * Ports and ceilings candidate resolution needs. The catalog validates model support
 * (including the candidate's model parameters) and lists per-provider model menus;
 * trust supplies the environment ceilings and the availability predicate; session
 * (and optionally role) narrow policy further. The repository is only consulted for
 * load-balancer members. Provider templates are never consulted here: template
 * availability does not change candidate validity.
 */
export interface ResolveProfileCandidateDeps {
  catalog: ProviderModelCatalogPort;
  trust: TrustToolEnvironmentPort;
  session: PolicyCeiling;
  role?: PolicyCeiling;
  repository?: ProfileRepositoryPort;
}

/**
 * Result of resolving a profile candidate.
 *
 * `status` precedence is invalid > unverified > valid. Drafts that never enter a
 * runtime still get a full resolver record; unverified constraints are surfaced so the
 * caller can defer a build instead of silently treating an unverifiable candidate as
 * valid.
 */
export type ProfileCandidateResolution = {
  status: 'valid' | 'invalid' | 'unverified';
  resolved: ResolvedProfileSpec;
  memberCaptures?: Readonly<Record<string, CapturedStandardSource>>;
  errors: readonly string[];
  warnings: readonly string[];
  unverifiedConstraints: readonly string[];
  requestedVsEffective: readonly PolicyExplanation[];
};

/**
 * Build the environment policy ceiling from the trust port.
 */
function trustPolicyCeiling(trust: TrustToolEnvironmentPort): PolicyCeiling {
  return {
    allowedTools: trust.getToolCeiling().allowedTools,
    disabledTools: trust.getToolCeiling().disabledTools,
    shellMode: trust.getShellCeiling(),
    approvalCeiling: trust.getApprovalCeiling(),
  };
}

async function loadRawProfile(
  name: string,
  repository: ProfileRepositoryPort | undefined,
  errors: string[],
): Promise<ProfileDocument | null> {
  if (repository === undefined) {
    errors.push(`member ${name} could not be loaded`);
    return null;
  }
  let document: ProfileDocument;
  try {
    const entry = await repository.load(name);
    document = entry.document;
  } catch {
    errors.push(`member ${name} could not be loaded`);
    return null;
  }
  return document;
}

function enforceLoaded(
  document: ProfileDocument | null,
  name: string,
  errors: string[],
): StandardProfileDocument | null {
  if (document === null) {
    return null;
  }
  if (isStandardProfileDocument(document)) {
    return document;
  }
  errors.push(`member ${name} must be a standard profile`);
  return null;
}

async function rawMember(
  name: string,
  repository: ProfileRepositoryPort | undefined,
  errors: string[],
): Promise<StandardProfileDocument | null> {
  const raw = await loadRawProfile(name, repository, errors);
  return enforceLoaded(raw, name, errors);
}

async function resolveMembers(
  document: LoadBalancerProfileDocument,
  deps: ResolveProfileCandidateDeps,
  errors: string[],
): Promise<Readonly<Record<string, StandardProfileDocument>>> {
  const members: Record<string, StandardProfileDocument> = {};
  for (const name of document.profiles) {
    const loaded = await rawMember(name, deps.repository, errors);
    if (loaded !== null) {
      members[name] = loaded;
    }
  }
  return members;
}

async function modelMenu(
  provider: string,
  catalog: ProviderModelCatalogPort,
  menus: Map<string, readonly string[]>,
  unverified: string[],
): Promise<readonly string[]> {
  const cached = menus.get(provider);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const models = await catalog.listModels(provider);
    menus.set(provider, models);
    return models;
  } catch {
    unverified.push(`model menu unavailable for provider ${provider}`);
    return [];
  }
}

async function captureMembers(
  document: LoadBalancerProfileDocument,
  members: Readonly<Record<string, StandardProfileDocument>>,
  catalog: ProviderModelCatalogPort,
  unverified: string[],
): Promise<Readonly<Record<string, CapturedStandardSource>>> {
  const captures: Record<string, CapturedStandardSource> = {};
  const menus = new Map<string, readonly string[]>();
  const memberEntries = Object.entries(members);
  for (const entry of memberEntries) {
    const models = await modelMenu(
      entry[1].provider,
      catalog,
      menus,
      unverified,
    );
    captures[entry[0]] = {
      revision: 0,
      provider: entry[1].provider,
      sourceDocument: entry[1],
      models,
    };
  }
  return captures;
}

function flagModelSupport(
  support: { status: 'valid' | 'invalid' | 'unknown'; reason?: string },
  model: string,
  provider: string,
  errors: string[],
  unverified: string[],
): void {
  if (support.status === 'invalid') {
    if (support.reason !== undefined && support.reason.length > 0) {
      errors.push(support.reason);
    }
    errors.push(`model ${model} is not supported by provider ${provider}`);
  }
  if (support.status === 'unknown') {
    unverified.push(`model support unknown for provider ${provider}`);
  }
}

async function flagMemberModels(
  document: LoadBalancerProfileDocument,
  members: Readonly<Record<string, StandardProfileDocument>>,
  catalog: ProviderModelCatalogPort,
  errors: string[],
  unverified: string[],
): Promise<void> {
  const memberEntries = Object.entries(members);
  for (const entry of memberEntries) {
    const support = await catalog.validateModelSupport(
      entry[1].provider,
      entry[1].model,
      entry[1].modelParams,
    );
    flagModelSupport(
      support,
      entry[1].model,
      entry[1].provider,
      errors,
      unverified,
    );
  }
}

/**
 * Candidate resolution over a load-balancer document: the document is the
 * load-balancer member the existing {@link isLoadBalancerProfileDocument} predicate
 * narrowed before this input was built.
 */
type LoadBalancerResolutionInput = ProfileCandidateResolutionInput & {
  document: LoadBalancerProfileDocument;
};

/**
 * Candidate resolution over a standard document: the complement of the load-balancer
 * predicate narrowing on the complete {@link ProfileDocument} union.
 */
type StandardResolutionInput = ProfileCandidateResolutionInput & {
  document: StandardProfileDocument;
};

function applyPolicy(
  intent: ProfilePolicyIntent,
  deps: ResolveProfileCandidateDeps,
  errors: string[],
  warnings: string[],
  requestedVsEffective: PolicyExplanation[],
): ReturnType<typeof intersectPolicy> {
  const outcome = intersectPolicy(
    intent,
    trustPolicyCeiling(deps.trust),
    deps.session,
    deps.role,
    (toolId) => deps.trust.isToolAvailable(toolId),
  );
  errors.push(...outcome.errors);
  warnings.push(...outcome.warnings);
  requestedVsEffective.push(...outcome.explanations);
  return outcome;
}

async function resolveLoadBalancerSpec(
  input: LoadBalancerResolutionInput,
  deps: ResolveProfileCandidateDeps,
): Promise<ProfileCandidateResolution> {
  const loadable = input.document;
  const errors: string[] = [];
  const warnings: string[] = [];
  const unverified: string[] = [];
  const requestedVsEffective: PolicyExplanation[] = [];
  const members = await resolveMembers(loadable, deps, errors);
  const bindingsOutcome = memberCredentialBindings(loadable, members);
  warnings.push(...bindingsOutcome.warnings);
  const captures = await captureMembers(
    loadable,
    members,
    deps.catalog,
    unverified,
  );
  await flagMemberModels(loadable, members, deps.catalog, errors, unverified);
  const policyOutcome = applyPolicy(
    input.policyIntent,
    deps,
    errors,
    warnings,
    requestedVsEffective,
  );
  return {
    status: resultStatus(errors, unverified),
    resolved: {
      document: input.document,
      credentialBindings: bindingsOutcome.bindings,
      policy: policyOutcome.policy,
      memberDocuments: members,
    },
    memberCaptures: captures,
    errors,
    warnings,
    unverifiedConstraints: unverified,
    requestedVsEffective,
  };
}

function applyPolicyForStandard(
  intent: ProfilePolicyIntent,
  deps: ResolveProfileCandidateDeps,
  errors: string[],
  warnings: string[],
  requestedVsEffective: PolicyExplanation[],
): ReturnType<typeof intersectPolicy> {
  return applyPolicy(intent, deps, errors, warnings, requestedVsEffective);
}

async function resolveStandardDocument(
  input: StandardResolutionInput,
  deps: ResolveProfileCandidateDeps,
): Promise<ProfileCandidateResolution> {
  const standardDocument = input.document;
  const errors: string[] = [];
  const warnings: string[] = [];
  const unverified: string[] = [];
  const requestedVsEffective: PolicyExplanation[] = [];
  let bindings: readonly CredentialBinding[] = [];
  const blankDraft =
    standardDocument.provider === '' && standardDocument.model === '';
  const policyOutcome = applyPolicyForStandard(
    input.policyIntent,
    deps,
    errors,
    warnings,
    requestedVsEffective,
  );
  if (blankDraft) {
    bindings = [];
    return {
      status: errors.length > 0 ? 'invalid' : 'valid',
      resolved: {
        document: standardDocument,
        credentialBindings: bindings,
        policy: policyOutcome.policy,
      },
      errors,
      warnings,
      unverifiedConstraints: unverified,
      requestedVsEffective,
    };
  }
  if (standardDocument.provider === '') {
    errors.push('provider is required');
    return {
      status: 'invalid',
      resolved: {
        document: standardDocument,
        credentialBindings: bindings,
        policy: policyOutcome.policy,
      },
      errors,
      warnings,
      unverifiedConstraints: unverified,
      requestedVsEffective,
    };
  }
  const bindingsOutcome = deriveCredentialBindings(standardDocument);
  warnings.push(...bindingsOutcome.warnings);
  bindings = bindingsOutcome.bindings;
  const support = await deps.catalog.validateModelSupport(
    standardDocument.provider,
    standardDocument.model,
    standardDocument.modelParams,
  );
  flagModelSupport(
    support,
    standardDocument.model,
    standardDocument.provider,
    errors,
    unverified,
  );
  return {
    status: resultStatus(errors, unverified),
    resolved: {
      document: standardDocument,
      credentialBindings: bindings,
      policy: policyOutcome.policy,
    },
    errors,
    warnings,
    unverifiedConstraints: unverified,
    requestedVsEffective,
  };
}

/**
 * Resolve a profile candidate into a buildable spec.
 *
 * A blank setup draft (empty provider and model) is a valid draft the controller
 * may commit without a runtime build. Standard documents validate model support through the
 * catalog and derive their credential bindings from their own document. Load-balancer
 * documents load each member through the repository, capture each member's model menu, and
 * carry per-member credential bindings; the loaded member documents also travel on the
 * resolved spec as `memberDocuments` so construction never rereads them. The returned
 * document is always the original input, never a copy or mutation.
 */
export async function resolveProfileCandidate(
  input: ProfileCandidateResolutionInput,
  deps: ResolveProfileCandidateDeps,
): Promise<ProfileCandidateResolution> {
  if (isLoadBalancerProfileDocument(input.document)) {
    return resolveLoadBalancerSpec(
      { document: input.document, policyIntent: input.policyIntent },
      deps,
    );
  }
  return resolveStandardDocument(
    { document: input.document, policyIntent: input.policyIntent },
    deps,
  );
}

function resultStatus(
  errors: readonly string[],
  unverified: readonly string[],
): 'valid' | 'invalid' | 'unverified' {
  if (errors.length > 0) {
    return 'invalid';
  }
  if (unverified.length > 0) {
    return 'unverified';
  }
  return 'valid';
}
