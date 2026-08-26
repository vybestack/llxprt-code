/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Startup-only resolution of the trusted `runtimePlugins` setting (issue #2758).
 *
 * Runtime plugins are trusted, unsandboxed executable code: importing one runs
 * arbitrary code with the full privileges of the CLI process. They may therefore
 * only be configured in the user (global), system, or system-defaults settings
 * layers. A `runtimePlugins` value in project/workspace settings is rejected
 * outright rather than merged, because a repository must never be able to make
 * the CLI execute code by being opened.
 *
 * Resolution happens exactly once, during startup, before the provider manager
 * is constructed. There is no reload path.
 */

import { isBuiltin } from 'node:module';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { SettingScope } from './settings.js';
import type { LoadedSettings, SettingsFile } from './settings.js';

export const RUNTIME_PLUGINS_SETTING = 'runtimePlugins';

/** Unscoped bare package root, e.g. `my-plugin`. */
const UNSCOPED_PACKAGE = /^[a-z0-9][a-z0-9._-]*$/;
/** Scoped bare package root, e.g. `@scope/my-plugin`. */
const SCOPED_PACKAGE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
/** Any specifier carrying a URL scheme, e.g. `file:`, `https:`, `data:`. */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
/** Windows drive-letter prefix, e.g. `C:\pkg`. */
const WINDOWS_DRIVE = /^[A-Za-z]:/;
/** npm's maximum package-name length. */
const MAX_PACKAGE_NAME_LENGTH = 214;

/** Prefixes that make a specifier a filesystem path rather than a bare root. */
const PATH_PREFIXES = ['/', '~', './', '../'] as const;
/** Specifiers that are the current or parent directory outright. */
const PATH_LITERALS = ['.', '..'] as const;

function isPathSpecifier(specifier: string): boolean {
  if (PATH_LITERALS.some((literal) => specifier === literal)) {
    return true;
  }
  if (PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return true;
  }
  return specifier.includes('\\') || WINDOWS_DRIVE.test(specifier);
}

function isSubpathSpecifier(specifier: string): boolean {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.length > 2 : segments.length > 1;
}

/**
 * Validates one configured entry and returns the normalized specifier.
 *
 * Only bare npm package roots are accepted (`my-plugin`, `@scope/my-plugin`).
 * Every other shape throws, naming the offending value and the reason: empty
 * values, Node built-in modules, URLs, filesystem paths, package subpaths, and
 * otherwise malformed package names.
 */
export function normalizeRuntimePluginSpecifier(value: string): string {
  const specifier = value.trim();
  if (specifier === '') {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry: the value is empty. ` +
        `Only bare npm package roots are accepted.`,
    );
  }
  if (isPathSpecifier(specifier)) {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry '${specifier}': a filesystem ` +
        `path is not accepted. Only bare npm package roots are accepted.`,
    );
  }
  if (isBuiltin(specifier)) {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry '${specifier}': a Node ` +
        `built-in module is not accepted. Only bare npm package roots are accepted.`,
    );
  }
  if (URL_SCHEME.test(specifier)) {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry '${specifier}': a URL is not ` +
        `accepted. Only bare npm package roots are accepted.`,
    );
  }
  if (isSubpathSpecifier(specifier)) {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry '${specifier}': a package ` +
        `subpath is not accepted. Only bare npm package roots are accepted.`,
    );
  }
  if (
    specifier.length > MAX_PACKAGE_NAME_LENGTH ||
    (!UNSCOPED_PACKAGE.test(specifier) && !SCOPED_PACKAGE.test(specifier))
  ) {
    throw new Error(
      `Invalid ${RUNTIME_PLUGINS_SETTING} entry '${specifier}': malformed npm ` +
        `package name. Only bare npm package roots are accepted.`,
    );
  }
  return specifier;
}

function readTrustedScope(
  settings: LoadedSettings,
  scope: SettingScope,
  scopeLabel: string,
): string[] {
  const file: SettingsFile = settings.forScope(scope);
  const value: unknown = (file.settings as Record<string, unknown>)[
    RUNTIME_PLUGINS_SETTING
  ];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `${RUNTIME_PLUGINS_SETTING} in ${scopeLabel} settings (${file.path}) must ` +
        `be an array of bare npm package roots, but found: ${JSON.stringify(value)}.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(
        `${RUNTIME_PLUGINS_SETTING} in ${scopeLabel} settings (${file.path}) must ` +
          `contain only strings, but found: ${JSON.stringify(entry)}.`,
      );
    }
    return normalizeRuntimePluginSpecifier(entry);
  });
}

function rejectUntrustedProvenance(settings: LoadedSettings): void {
  const workspace: SettingsFile = settings.forScope(SettingScope.Workspace);
  const workspaceValue: unknown = (
    workspace.settings as Record<string, unknown>
  )[RUNTIME_PLUGINS_SETTING];
  if (workspaceValue === undefined) {
    return;
  }
  throw new Error(
    `${RUNTIME_PLUGINS_SETTING} is not allowed in workspace (project) settings ` +
      `(${workspace.path}). Runtime plugins are trusted, unsandboxed ` +
      `executable code, so they may only be configured in user (global) or ` +
      `system settings. Remove ${RUNTIME_PLUGINS_SETTING} from the workspace ` +
      `settings file.`,
  );
}

/**
 * Resolves the ordered runtime plugin specifiers from the trusted settings
 * layers. Order is deterministic: system defaults, then system, then user, each
 * preserving its own array order.
 *
 * Throws when the setting appears in workspace settings, when a layer's value is
 * not an array of strings, or when any entry is not a bare npm package root.
 */
export function resolveRuntimePluginSpecifiers(
  settings: LoadedSettings,
): readonly string[] {
  rejectUntrustedProvenance(settings);
  const ordered = [
    ...readTrustedScope(
      settings,
      SettingScope.SystemDefaults,
      'system defaults',
    ),
    ...readTrustedScope(settings, SettingScope.System, 'system'),
    ...readTrustedScope(settings, SettingScope.User, 'user'),
  ];
  // Listing the same package in two trusted layers is a benign misconfiguration,
  // not a collision: the module resolves to one cached module with one manifest.
  // Deduplicate on first occurrence so the loader's duplicate-plugin-id failure
  // is reserved for genuinely different packages claiming the same id.
  return [...new Set(ordered)];
}

/**
 * Startup entry point: resolves the trusted specifiers and loads them once, in
 * configured order, returning the local immutable provider contribution
 * registry that alias construction dispatches through.
 */
export async function loadCliRuntimePlugins(
  settings: LoadedSettings,
): Promise<ProviderContributionRegistry> {
  const specifiers = resolveRuntimePluginSpecifiers(settings);
  // Module resolution lives in the providers package, which owns plugin
  // loading. The CLI owns policy (provenance and specifier shape) and has
  // already applied it above.
  return loadRuntimePlugins(specifiers);
}
