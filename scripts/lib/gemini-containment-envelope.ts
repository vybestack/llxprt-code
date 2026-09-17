/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * gemini-containment-envelope.ts — envelope layer of the #2628
 * Gemini-containment gate: plugin-manifest ↔ PLUGIN_PROVIDED_PROVIDER_HINTS
 * exact-set parity with package attribution. Manifests and the base hint
 * table are read structurally — balanced, string/comment-aware literal
 * extraction (the gate never imports plugin code) — so hint/manifest parsing
 * stays linear-time and the scripts lane stays dependency-free.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isRecord,
  parseLooseJson,
  PLUGINS_DIR,
  readTextOrError,
  type GateViolation,
  type LayerResult,
} from './gemini-containment-shared.ts';

/** Base-side hint table read structurally (never imported). */
const HINTS_REL_PATH =
  'packages/providers/src/composition/runtimePlugins/pluginProvidedProviders.ts';

function closerFor(open: string): string | null {
  if (open === '{') return '}';
  if (open === '[') return ']';
  if (open === '(') return ')';
  return null;
}

function isOpener(ch: string): boolean {
  return ch === '{' || ch === '[' || ch === '(';
}

function isCloser(ch: string): boolean {
  return ch === '}' || ch === ']' || ch === ')';
}

function skipQuoted(text: string, from: number, quote: string): number {
  let i = from + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

function skipLineComment(text: string, from: number): number {
  let i = from;
  while (i < text.length && text[i] !== '\n') i++;
  return i;
}

function skipBlockComment(text: string, from: number): number {
  let i = from + 2;
  while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
  return i + 2;
}

/**
 * Index of the next significant character at or after `from`, jumping over
 * quoted strings (with escapes) and line/block comments.
 */
function skipInsignificant(text: string, from: number): number {
  const ch = text[from];
  if (ch === '"' || ch === "'" || ch === '`') return skipQuoted(text, from, ch);
  if (ch === '/' && text[from + 1] === '/') return skipLineComment(text, from);
  if (ch === '/' && text[from + 1] === '*') return skipBlockComment(text, from);
  return from;
}

/**
 * Balanced, string/comment-aware slice: given the index of an opening `{`,
 * `[` or `(`, return the index just past its matching closer, or -1 when the
 * literal never closes.
 */
function balancedEnd(text: string, openIndex: number): number {
  const close = closerFor(text[openIndex]);
  if (close === null) return -1;
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const significant = skipInsignificant(text, i);
    if (significant !== i) {
      i = significant;
      continue;
    }
    const ch = text[i];
    if (isOpener(ch)) {
      depth++;
    } else if (isCloser(ch)) {
      depth--;
      if (depth === 0 && ch === close) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * First index of `needle` occurring in normal code state — outside strings,
 * template literals, and line/block comments — at or after `from`. Anchor
 * lookups use this so a name mentioned in a doc comment can never hijack a
 * literal extraction.
 */
function codeIndex(text: string, needle: string, from = 0): number {
  let i = from;
  while (i < text.length) {
    const significant = skipInsignificant(text, i);
    if (significant !== i) {
      i = significant;
      continue;
    }
    if (text.startsWith(needle, i)) return i;
    i++;
  }
  return -1;
}

/**
 * Balanced, string/comment-aware slice: return the source text of the first
 * `opener`-delimited literal following `anchor` in normal code state, or null
 * when the anchor or a well-balanced literal cannot be found.
 */
function literalAfter(
  text: string,
  anchor: string,
  opener: '{' | '[' | '(',
): string | null {
  const anchorIndex = codeIndex(text, anchor);
  if (anchorIndex === -1) return null;
  const openIndex = codeIndex(text, opener, anchorIndex + anchor.length);
  if (openIndex === -1) return null;
  const end = balancedEnd(text, openIndex);
  return end === -1 ? null : text.slice(openIndex, end);
}

interface PluginContribution {
  readonly providerId: string;
  readonly aliases: string[];
}

export interface ParsedPluginManifest {
  readonly contributions: PluginContribution[];
}

/**
 * Structurally parse a plugin src/index.ts manifest literal (never imported):
 * extracts every providers[] entry's providerId plus its builtinAliases
 * alias names. Template-literal interpolation inside the manifest literal is
 * unsupported by design — manifests are static data.
 */
export function parsePluginManifestLiteral(
  source: string,
): ParsedPluginManifest | string {
  const objectText = literalAfter(source, 'llxprtRuntimePlugin', '{');
  if (objectText === null) return 'llxprtRuntimePlugin manifest literal not found';
  const providersArray = literalAfter(objectText, 'providers', '[');
  if (providersArray === null) return 'providers array not found in manifest';
  return parseProviderEntries(providersArray);
}

function parseProviderEntries(
  providersArray: string,
): ParsedPluginManifest | string {
  const contributions: PluginContribution[] = [];
  for (let i = 0; i < providersArray.length; i++) {
    if (providersArray[i] !== '{') continue;
    const end = balancedEnd(providersArray, i);
    if (end === -1) return 'unbalanced providers entry in manifest';
    const parsed = parseProviderEntry(providersArray.slice(i, end));
    if (typeof parsed === 'string') return parsed;
    contributions.push(parsed);
    i = end - 1;
  }
  return { contributions };
}

function parseProviderEntry(
  elementText: string,
): PluginContribution | string {
  const idMatch = /providerId\s*:\s*(['"])([\s\S]*?)\1/.exec(elementText);
  if (idMatch === null) {
    return 'providers entry without a providerId in manifest';
  }
  return { providerId: idMatch[2], aliases: parseAliasNames(elementText) };
}

function parseAliasNames(elementText: string): string[] {
  const aliases: string[] = [];
  const aliasesText = literalAfter(elementText, 'builtinAliases', '[');
  if (aliasesText === null) return aliases;
  const aliasRegex = /\balias\s*:\s*(['"])([\s\S]*?)\1/g;
  for (const match of aliasesText.matchAll(aliasRegex)) {
    aliases.push(match[2] ?? '');
  }
  return aliases;
}

/**
 * One `key: 'value'` hint entry on a single (prettier-formatted) line: the
 * first colon splits key from value, and one trailing comma plus trailing
 * whitespace is stripped. Parsed with an indexOf walk so hint-line handling
 * stays linear — no regex backtracking on hostile line shapes.
 */
function parseHintEntryLine(
  line: string,
): { readonly key: string; readonly value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const rest = line.slice(colon + 1).trimStart();
  if (rest.length === 0) return null;
  const body = rest.trimEnd();
  const stripped = body.endsWith(',') ? body.slice(0, -1) : body;
  const value = stripped.length > 0 ? stripped : body;
  return { key: line.slice(0, colon), value };
}

function unquote(text: string): string {
  return text.replace(/^['"]/, '').replace(/['"]$/, '');
}

function parseHintEntries(objectText: string): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const line of objectText.split('\n')) {
    const entry = parseHintEntryLine(line.trim());
    if (entry === null) continue;
    hints[unquote(entry.key.trim())] = unquote(entry.value.trim());
  }
  return hints;
}

/** Structurally read PLUGIN_PROVIDED_PROVIDER_HINTS from the base source. */
export function parseProviderHints(
  source: string,
): Record<string, string> | string {
  const objectText = literalAfter(
    source,
    'PLUGIN_PROVIDED_PROVIDER_HINTS',
    '{',
  );
  if (objectText === null) return 'PLUGIN_PROVIDED_PROVIDER_HINTS literal not found';
  return parseHintEntries(objectText);
}

interface DiscoveredPlugin {
  readonly dir: string;
  readonly name: string;
  readonly manifest: ParsedPluginManifest;
}

function readPluginManifestEntry(
  root: string,
  dir: string,
  errors: string[],
): DiscoveredPlugin | null {
  const manifestRel = `${dir}/package.json`;
  const manifestRead = readTextOrError(root, manifestRel);
  if (manifestRead.error !== null) {
    errors.push(manifestRead.error);
    return null;
  }
  const parsed = parseLooseJson(manifestRel, manifestRead.text);
  if (parsed.error !== null || !isRecord(parsed.value)) {
    errors.push(parsed.error ?? `${manifestRel}: must contain a JSON object.`);
    return null;
  }
  const name = parsed.value['name'];
  if (typeof name !== 'string') {
    errors.push(`${manifestRel}: "name" must be a string — fail-closed.`);
    return null;
  }
  const indexRel = `${dir}/src/index.ts`;
  const indexRead = readTextOrError(root, indexRel);
  if (indexRead.error !== null) {
    errors.push(indexRead.error);
    return null;
  }
  const manifest = parsePluginManifestLiteral(indexRead.text);
  if (typeof manifest === 'string') {
    errors.push(`${indexRel}: ${manifest} — fail-closed.`);
    return null;
  }
  return { dir, name, manifest };
}

function discoverPlugins(
  root: string,
  errors: string[],
): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = [];
  let entries;
  try {
    entries = readdirSync(join(root, PLUGINS_DIR), { withFileTypes: true });
  } catch (e) {
    errors.push(
      `${PLUGINS_DIR}/: cannot read (${e instanceof Error ? e.message : String(e)}) — fail-closed.`,
    );
    return plugins;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const plugin = readPluginManifestEntry(
      root,
      `${PLUGINS_DIR}/${entry.name}`,
      errors,
    );
    if (plugin !== null) plugins.push(plugin);
  }
  return plugins;
}

interface EnvelopeState {
  readonly violations: GateViolation[];
  readonly hints: Record<string, string>;
  readonly capabilityIds: Set<string>;
  readonly aliasNames: Set<string>;
  readonly capabilityOwners: Map<string, string>;
}

function envelopeViolation(
  plugin: DiscoveredPlugin,
  message: string,
): GateViolation {
  return {
    layer: 'envelope',
    file: `${plugin.dir}/src/index.ts`,
    line: 1,
    message,
  };
}

function checkSingleCapabilityOwner(
  plugin: DiscoveredPlugin,
  providerId: string,
  state: EnvelopeState,
): void {
  const owner = state.capabilityOwners.get(providerId);
  if (owner === undefined) return;
  state.violations.push(
    envelopeViolation(
      plugin,
      `provider id "${providerId}" is capability-` +
        `contributed by both ${owner} and ${plugin.name} — the ` +
        'exact-set requires one owning plugin per capability.',
    ),
  );
}

function checkHintedPackage(
  plugin: DiscoveredPlugin,
  providerId: string,
  state: EnvelopeState,
): void {
  const hinted = state.hints[providerId];
  if (hinted === plugin.name) return;
  const where =
    hinted === undefined ? 'absent from' : `hinted to ${hinted} by`;
  state.violations.push(
    envelopeViolation(
      plugin,
      `contributed provider id "${providerId}" (${plugin.name}) ` +
        `is ${where} ` +
        'PLUGIN_PROVIDED_PROVIDER_HINTS — exact-set parity requires the ' +
        'base hint table to name exactly this package.',
    ),
  );
}

function checkContributedAlias(
  plugin: DiscoveredPlugin,
  alias: string,
  state: EnvelopeState,
): void {
  state.aliasNames.add(alias);
  if (alias in state.hints) return;
  state.violations.push(
    envelopeViolation(
      plugin,
      `built-in alias "${alias}" (${plugin.name}) is absent from ` +
        'PLUGIN_PROVIDED_PROVIDER_HINTS — provider ids plus built-in ' +
        'aliases must exactly equal the hinted capability set.',
    ),
  );
}

function checkCapabilityContribution(
  plugin: DiscoveredPlugin,
  contribution: PluginContribution,
  state: EnvelopeState,
): void {
  checkSingleCapabilityOwner(plugin, contribution.providerId, state);
  state.capabilityOwners.set(contribution.providerId, plugin.name);
  state.capabilityIds.add(contribution.providerId);
  checkHintedPackage(plugin, contribution.providerId, state);
  for (const alias of contribution.aliases) {
    checkContributedAlias(plugin, alias, state);
  }
}

function checkStubContribution(
  plugin: DiscoveredPlugin,
  contribution: PluginContribution,
  state: EnvelopeState,
): void {
  if (!(contribution.providerId in state.hints)) return;
  state.violations.push(
    envelopeViolation(
      plugin,
      `PLUGIN_PROVIDED_PROVIDER_HINTS entry "${contribution.providerId}" ` +
        `points at ${plugin.name}, which contributes it WITHOUT a ` +
        'built-in alias (reserved stubs are not hinted capabilities).',
    ),
  );
}

function checkPluginContributions(
  plugin: DiscoveredPlugin,
  state: EnvelopeState,
): void {
  for (const contribution of plugin.manifest.contributions) {
    if (contribution.aliases.length > 0) {
      checkCapabilityContribution(plugin, contribution, state);
    } else {
      checkStubContribution(plugin, contribution, state);
    }
  }
}

function checkUnmatchedHint(
  hintId: string,
  hintPackage: string,
  state: EnvelopeState,
): void {
  if (state.capabilityIds.has(hintId) || state.aliasNames.has(hintId)) return;
  state.violations.push({
    layer: 'envelope',
    file: HINTS_REL_PATH,
    line: 1,
    message:
      `PLUGIN_PROVIDED_PROVIDER_HINTS entry "${hintId}" -> "${hintPackage}" ` +
      'is not contributed (with a built-in alias) by the manifest of that ' +
      'plugin — the hinted capability set must exactly equal the set the ' +
      'plugin manifests contribute.',
  });
}

/**
 * Envelope exact-set: plugin-contributed provider ids + built-in aliases must
 * equal the base hint table's capability set, with package attribution.
 */
export function checkEnvelopeLayer(root: string): LayerResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const hintsRead = readTextOrError(root, HINTS_REL_PATH);
  if (hintsRead.error !== null) {
    errors.push(hintsRead.error);
    return { violations, errors };
  }
  const hints = parseProviderHints(hintsRead.text);
  if (typeof hints === 'string') {
    errors.push(`${HINTS_REL_PATH}: ${hints} — fail-closed.`);
    return { violations, errors };
  }
  const plugins = discoverPlugins(root, errors);
  const state: EnvelopeState = {
    violations,
    hints,
    capabilityIds: new Set<string>(),
    aliasNames: new Set<string>(),
    capabilityOwners: new Map<string, string>(),
  };
  for (const plugin of plugins) {
    checkPluginContributions(plugin, state);
  }
  for (const [hintId, hintPackage] of Object.entries(hints)) {
    checkUnmatchedHint(hintId, hintPackage, state);
  }
  return { violations, errors };
}
