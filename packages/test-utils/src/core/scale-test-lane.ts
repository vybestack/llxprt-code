/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export const NIGHTLY_TESTS_WORKFLOW_NAME = 'Nightly Tests';

export interface ScaleTestEnvironment {
  readonly [name: string]: string | undefined;
  readonly LLXPRT_SCALE_EXTENDED?: string;
  readonly GITHUB_WORKFLOW?: string;
  readonly GITHUB_EVENT_NAME?: string;
}

export function scaleTestLane(
  environment: ScaleTestEnvironment = process.env,
): 'default' | 'extended' {
  const override = environment.LLXPRT_SCALE_EXTENDED;
  if (override === '1') return 'extended';
  if (override === '0') return 'default';
  if (override !== undefined) {
    throw new Error('LLXPRT_SCALE_EXTENDED must be absent, "0", or "1"');
  }
  return environment.GITHUB_WORKFLOW === NIGHTLY_TESTS_WORKFLOW_NAME &&
    (environment.GITHUB_EVENT_NAME === 'schedule' ||
      environment.GITHUB_EVENT_NAME === 'workflow_dispatch')
    ? 'extended'
    : 'default';
}

export function selectScaleCases<T>(
  defaultCases: readonly T[],
  extendedCases: readonly T[],
  environment: ScaleTestEnvironment = process.env,
): readonly T[] {
  return scaleTestLane(environment) === 'extended'
    ? [...defaultCases, ...extendedCases]
    : [...defaultCases];
}
