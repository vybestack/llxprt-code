/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google Gemini runtime plugin (issue #2759 scaffolding).
 *
 * The host loader (`@vybestack/llxprt-code-providers` composition barrel)
 * imports this package's named `llxprtRuntimePlugin` export and validates it
 * against manifest v1 before anything is constructed, so the manifest is the
 * entire host contract this package must satisfy today.
 *
 * The provider id is a placeholder. Contributing `gemini` now would collide
 * with the built-in `gemini` contribution and make this plugin unloadable
 * alongside the base CLI; the built-in is removed only by the Gemini
 * production extraction (#2763), which retires this placeholder in favor of
 * the real `gemini` provider id, built-in alias, and alias-aware factory.
 */
import type {
  ProviderAliasFactory,
  RuntimePluginManifest,
} from '@vybestack/llxprt-code-providers/composition.js';

const createPlaceholderGeminiProvider: ProviderAliasFactory = () => {
  throw new Error(
    "The @vybestack/llxprt-plugin-google-gemini plugin does not contribute a usable 'google-gemini' provider yet. " +
      'Provider construction arrives with the Gemini extraction; use the built-in gemini provider.',
  );
};

export const llxprtRuntimePlugin = {
  apiVersion: 1,
  id: '@vybestack/llxprt-plugin-google-gemini',
  providers: [
    {
      providerId: 'google-gemini',
      createProvider: createPlaceholderGeminiProvider,
    },
  ],
} satisfies RuntimePluginManifest;
