import type { Profile } from '@vybestack/llxprt-code-settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getProfileEphemeralSettings(
  profile: Profile,
): Record<string, unknown> {
  const settings: unknown = profile.ephemeralSettings;
  return isRecord(settings) ? settings : {};
}

export function getProfileModelParams(
  profile: Profile,
): Record<string, unknown> {
  const params: unknown = profile.modelParams;
  return isRecord(params) ? params : {};
}

export function getProfileProvider(profile: Profile): string {
  return profile.provider;
}

export function getProfileModel(profile: Profile): string {
  return profile.model;
}

export function getStringValue(
  ephemerals: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = ephemerals[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  return undefined;
}

export function isPositiveContextLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
