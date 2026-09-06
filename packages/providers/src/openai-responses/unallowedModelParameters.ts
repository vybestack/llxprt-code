/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  computeUnallowedParameters,
  type ModelDefaultRule,
} from '../composition/providerAliases.js';

export type UnallowedModelParametersResolver = (model: string) => Set<string>;

export function createUnallowedModelParametersResolver(
  modelDefaultRules: readonly ModelDefaultRule[],
): UnallowedModelParametersResolver {
  const capturedModelDefaultRules = [...modelDefaultRules];
  return (model) =>
    computeUnallowedParameters(model, capturedModelDefaultRules);
}
