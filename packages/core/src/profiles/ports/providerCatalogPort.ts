/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StandardProfileDocument } from '../contracts/profileDocument.js';

/**
 * Metadata lookup for provider model catalogs.
 *
 * Query boundary for model availability and provider templates. `unknown` means the
 * catalog metadata is unavailable, which drives unverified (not invalid) command
 * results: the caller proceeds without a validity claim rather than treating the
 * model as unsupported.
 */
export interface ProviderModelCatalogPort {
  getDefaultModel(provider: string): Promise<string | undefined>;
  listModels(provider: string): Promise<readonly string[]>;
  /**
   * Validate a model — and any model parameters the candidate carries — against the
   * catalog's known capability constraints. Parameters the catalog cannot recognize
   * for a model whose schema it knows produce `invalid` with a reason; a model the
   * catalog does not know stays `unknown` regardless of parameters.
   */
  validateModelSupport(
    provider: string,
    model: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<
    | { status: 'valid' }
    | { status: 'invalid'; reason: string }
    | { status: 'unknown' }
  >;
  /**
   * The restricted blank template the catalog materializes for `provider`, when it
   * has one; `undefined` when the catalog carries no template for the provider.
   */
  getProviderTemplate(
    provider: string,
  ): Promise<StandardProfileDocument | undefined>;
}
