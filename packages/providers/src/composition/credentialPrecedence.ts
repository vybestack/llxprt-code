/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CredentialInputs {
  cliKey?: string;
  cliKeyfile?: string;
  cliBaseUrl?: string;
  profileKey?: string;
  profileKeyfile?: string;
  profileBaseUrl?: string;
}

export interface CredentialPrecedenceResult {
  inlineKey?: string;
  keyfilePath?: string;
  'base-url'?: string;
  inlineSource?: 'cli' | 'profile';
  keyfileSource?: 'cli' | 'profile';
  baseUrlSource?: 'cli' | 'profile';
}

export function resolveCredentialPrecedence(
  inputs: CredentialInputs,
): CredentialPrecedenceResult {
  const cleanedCliKey = cleanString(inputs.cliKey);
  const cleanedProfileKey = cleanString(inputs.profileKey);

  const result: CredentialPrecedenceResult = {};

  if (cleanedCliKey) {
    result.inlineKey = cleanedCliKey;
    result.inlineSource = 'cli';
  } else if (inputs.cliKeyfile) {
    result.keyfilePath = inputs.cliKeyfile;
    result.keyfileSource = 'cli';
  } else if (cleanedProfileKey) {
    result.inlineKey = cleanedProfileKey;
    result.inlineSource = 'profile';
  } else if (inputs.profileKeyfile) {
    result.keyfilePath = inputs.profileKeyfile;
    result.keyfileSource = 'profile';
  }

  const cleanedCliBaseUrl = cleanString(inputs.cliBaseUrl);
  if (cleanedCliBaseUrl) {
    result['base-url'] = inputs.cliBaseUrl;
    result.baseUrlSource = 'cli';
  } else if (inputs.profileBaseUrl) {
    result['base-url'] = inputs.profileBaseUrl;
    result.baseUrlSource = 'profile';
  }

  return result;
}

function cleanString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
