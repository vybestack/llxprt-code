import type { Profile } from '@vybestack/llxprt-code-core';

type PersistedProfileView = Omit<
  Partial<Profile>,
  'ephemeralSettings' | 'modelParams'
> & {
  ephemeralSettings?: Record<string, unknown> | null;
  modelParams?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
};

function asPersistedProfileView(profile: Profile): PersistedProfileView {
  return profile as unknown as PersistedProfileView;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getProfileEphemeralSettings(
  profile: Profile,
): Record<string, unknown> {
  const settings = asPersistedProfileView(profile).ephemeralSettings;
  return isRecord(settings) ? settings : {};
}

export function getProfileModelParams(
  profile: Profile,
): Record<string, unknown> {
  const params = asPersistedProfileView(profile).modelParams;
  return isRecord(params) ? params : {};
}

export function getProfileProvider(profile: Profile): string | undefined {
  const provider = asPersistedProfileView(profile).provider;
  return typeof provider === 'string' ? provider : undefined;
}

export function getProfileModel(profile: Profile): string | undefined {
  const model = asPersistedProfileView(profile).model;
  return typeof model === 'string' ? model : undefined;
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
