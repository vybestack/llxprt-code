/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LoadBalancerFailoverError } from '../errors.js';

export interface LoadBalancerContextLimitFailure {
  profile: string;
  error: Error;
}

function errorOptions(cause: Error | undefined): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}

export class LoadBalancerAllContextLimitsExceededError extends LoadBalancerFailoverError {
  constructor({
    profileName,
    failures,
  }: {
    profileName: string;
    failures: readonly LoadBalancerContextLimitFailure[];
  }) {
    super(profileName, [...failures]);
    this.name = 'LoadBalancerAllContextLimitsExceededError';
    this.message = buildAllContextLimitsMessage(profileName, failures);
  }
}

function buildAllContextLimitsMessage(
  profileName: string,
  failures: readonly LoadBalancerContextLimitFailure[],
): string {
  const details =
    failures.length === 0
      ? 'no failure details available'
      : failures
          .map((failure) => `${failure.profile}: ${failure.error.message}`)
          .join('; ');
  return `Load balancer "${profileName}" context limit exceeded for all eligible backends: ${details}`;
}

export class LoadBalancerCompressionCallbackError extends Error {
  readonly profileName: string;
  readonly subProfileName: string;

  constructor({
    profileName,
    subProfileName,
    cause,
  }: {
    profileName: string;
    subProfileName: string;
    cause: Error;
  }) {
    super(
      `Load balancer profile "${profileName}" sub-profile "${subProfileName}" compression callback failed: ${cause.message}`,
      { cause },
    );
    this.name = 'LoadBalancerCompressionCallbackError';
    this.profileName = profileName;
    this.subProfileName = subProfileName;
  }
}

export class LoadBalancerContextLimitError extends Error {
  readonly profileName: string;
  readonly subProfileName: string;
  readonly tokens: number;
  readonly contextLimit: number;

  constructor({
    profileName,
    subProfileName,
    tokens,
    contextLimit,
    cause,
  }: {
    profileName: string;
    subProfileName: string;
    tokens: number;
    contextLimit: number;
    cause?: Error;
  }) {
    super(
      `Load balancer profile "${profileName}" sub-profile "${subProfileName}" context limit exceeded: estimated ${tokens} tokens exceeds configured limit ${contextLimit}`,
      errorOptions(cause),
    );
    this.name = 'LoadBalancerContextLimitError';
    this.profileName = profileName;
    this.subProfileName = subProfileName;
    this.tokens = tokens;
    this.contextLimit = contextLimit;
  }
}
