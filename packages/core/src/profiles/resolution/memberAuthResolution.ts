/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialBinding } from '../ports/credentialResolverPort.js';
import type {
  LoadBalancerProfileDocument,
  StandardProfileDocument,
} from '../contracts/profileDocument.js';

export type MemberAuthOutcome = {
  binding: CredentialBinding | undefined;
  warnings: readonly string[];
};

export type MemberCredentialOutcome = {
  bindings: readonly CredentialBinding[];
  perMember: ReadonlyArray<{
    member: string;
    binding: CredentialBinding | undefined;
  }>;
  warnings: readonly string[];
};

/**
 * Derive a single member's credential binding.
 *
 * Precedence mirrors the standalone document derivation, scoped to the member. A member
 * with no explicit intent falls back to its own provider. Each member resolves its OWN
 * auth identity and never inherits any parent credential intent.
 */
export function deriveMemberAuthBinding(
  member: StandardProfileDocument,
): MemberAuthOutcome {
  if (member.auth?.type === 'oauth') {
    return {
      binding: {
        kind: 'oauth',
        provider: member.provider,
        buckets: member.auth.buckets ?? [],
      },
      warnings: [],
    };
  }
  const keyName = member.ephemeralSettings['auth-key-name'];
  if (typeof keyName === 'string') {
    return {
      binding: { kind: 'key-name', keyName },
      warnings: [],
    };
  }
  const keyfile = member.ephemeralSettings['auth-keyfile'];
  if (typeof keyfile === 'string') {
    return {
      binding: { kind: 'keyfile', path: keyfile },
      warnings: [],
    };
  }
  if (member.ephemeralSettings['auth-key'] !== undefined) {
    return {
      binding: undefined,
      warnings: ['inline auth-key present; prefer auth-key-name for rotation'],
    };
  }
  return {
    binding: { kind: 'provider-default', provider: member.provider },
    warnings: [],
  };
}

/**
 * Resolve every load-balancer member in `lb.profiles` order.
 *
 * Members are resolved in the load balancer's declared order with per-member
 * attribution: a member's binding always comes from the member's own document. A
 * member missing from the map produces a warning and no binding instead of erroring, so a
 * partially captured member set still resolves what it has.
 */
export function memberCredentialBindings(
  lb: LoadBalancerProfileDocument,
  members: Partial<Record<string, StandardProfileDocument>>,
): MemberCredentialOutcome {
  const bindings: CredentialBinding[] = [];
  const perMember: Array<{
    member: string;
    binding: CredentialBinding | undefined;
  }> = [];
  const warnings: string[] = [];
  for (const name of lb.profiles) {
    const member = members[name];
    if (member === undefined) {
      perMember.push({ member: name, binding: undefined });
      warnings.push(`member ${name} document unavailable`);
      continue;
    }
    const outcome = deriveMemberAuthBinding(member);
    perMember.push({ member: name, binding: outcome.binding });
    if (outcome.binding !== undefined) {
      bindings.push(outcome.binding);
    }
    warnings.push(...outcome.warnings);
  }
  return { bindings, perMember, warnings };
}
