/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Internal provenance for ephemeral keys currently owned by provider/model
 * default application (issue #3255).
 *
 * Ownership, not value equality or object identity, decides whether later
 * default application may replace, restore, or clear a key. Alias config
 * files are reparsed into fresh objects on every load, so object identity
 * cannot classify a stored map as default-owned, and an explicit session or
 * profile value can equal a default, so equality cannot classify it as
 * user-owned.
 *
 * Three ownership layers are tracked. Provider-owned entries record the
 * alias ephemeral defaults applied on provider switch and are restored when
 * a matching model default goes away (provider alias default > auto).
 * Model-owned keys record the model defaults currently in force and are
 * replaced wholesale (model default > provider alias default). User-owned
 * keys were written through the session/profile setter: default application
 * never manages them again until the write is cleared, which releases
 * ownership. A provider switch clears default-owned keys wholesale, so the
 * positive user-owned record is what lets explicit values survive it.
 */

interface EphemeralDefaultOwnership {
  providerOwned: ReadonlyMap<string, unknown>;
  modelOwned: ReadonlySet<string>;
  userOwned: ReadonlySet<string>;
}

const ownershipByConfig = new WeakMap<object, EphemeralDefaultOwnership>();

const EMPTY_PROVIDER_OWNED: ReadonlyMap<string, unknown> = new Map();
const EMPTY_MODEL_OWNED: ReadonlySet<string> = new Set<string>();
const EMPTY_USER_OWNED: ReadonlySet<string> = new Set<string>();

/**
 * Replace the provider-owned alias defaults for this config and reset model
 * ownership. Called when a provider switch applies a fresh alias surface, so
 * ownership left over from the previous provider is dropped even when the
 * new alias applies nothing. User-owned keys survive the replacement: an
 * explicit session or profile value outlives any provider switch.
 */
export function recordProviderDefaultOwnedEntries(
  config: object,
  entries: Iterable<readonly [string, unknown]>,
): void {
  ownershipByConfig.set(config, {
    providerOwned: new Map(entries),
    modelOwned: new Set<string>(),
    userOwned: ownershipByConfig.get(config)?.userOwned ?? EMPTY_USER_OWNED,
  });
}

/**
 * Replace the set of keys model default application owns for this config,
 * preserving the provider-owned alias defaults and user-owned keys recorded
 * alongside them.
 */
export function recordModelDefaultOwnedKeys(
  config: object,
  keys: Iterable<string>,
): void {
  const ownership = ownershipByConfig.get(config);
  ownershipByConfig.set(config, {
    providerOwned: ownership?.providerOwned ?? EMPTY_PROVIDER_OWNED,
    modelOwned: new Set(keys),
    userOwned: ownership?.userOwned ?? EMPTY_USER_OWNED,
  });
}

/** Provider alias default values default application may restore. */
export function getProviderDefaultOwnedEntries(
  config: object,
): ReadonlyMap<string, unknown> {
  return ownershipByConfig.get(config)?.providerOwned ?? EMPTY_PROVIDER_OWNED;
}

/** Keys model default application currently owns for this config. */
export function getModelDefaultOwnedKeys(config: object): ReadonlySet<string> {
  return ownershipByConfig.get(config)?.modelOwned ?? EMPTY_MODEL_OWNED;
}

/** Keys written through the session/profile path that defaults must keep. */
export function getUserOwnedEphemeralKeys(config: object): ReadonlySet<string> {
  return ownershipByConfig.get(config)?.userOwned ?? EMPTY_USER_OWNED;
}

/**
 * Issue #3255 reasoning settings that survive a provider switch while a
 * session/profile write owns them. Explicit values must not be overwritten
 * by the target provider's alias or model defaults; default-owned values
 * still clear or change.
 */
const USER_OWNED_SWITCH_PRESERVED_KEYS: ReadonlySet<string> = new Set([
  'reasoning.effortWireFormat',
  'reasoning.enabledWireFormat',
  'reasoning.effortMap',
  'reasoning.enabledMap',
]);

/**
 * Issue #3255 alias ephemeral keys whose values are objects: the registered
 * reasoning maps. Shared with provider switch so the alias surface and the
 * ownership record cannot drift apart on which keys carry maps.
 */
export const REASONING_OBJECT_VALUED_EPHEMERAL_KEYS: ReadonlySet<string> =
  new Set(['reasoning.effortMap', 'reasoning.enabledMap']);

/** True when a user write owns this issue #3255 reasoning setting. */
export function isUserOwnedReasoningSetting(
  config: object,
  key: string,
): boolean {
  return (
    USER_OWNED_SWITCH_PRESERVED_KEYS.has(key) &&
    getUserOwnedEphemeralKeys(config).has(key)
  );
}

/**
 * Mark a key user-owned so default application no longer manages it. The
 * record is created when no default has been applied yet: an explicit value
 * written before any default owns the key just the same.
 */
export function markEphemeralUserOwned(config: object, key: string): void {
  const ownership = ownershipByConfig.get(config);
  if (ownership === undefined) {
    ownershipByConfig.set(config, {
      providerOwned: EMPTY_PROVIDER_OWNED,
      modelOwned: EMPTY_MODEL_OWNED,
      userOwned: new Set([key]),
    });
    return;
  }
  const modelOwned = new Set(ownership.modelOwned);
  modelOwned.delete(key);
  const providerOwned = new Map(ownership.providerOwned);
  providerOwned.delete(key);
  const userOwned = new Set(ownership.userOwned);
  userOwned.add(key);
  ownershipByConfig.set(config, { providerOwned, modelOwned, userOwned });
}

/**
 * Release every ownership layer for a key. Clearing an explicit setting must
 * not leave permanent user ownership: default application manages the key
 * again from the next switch or model change. A key can be owned by several
 * layers at once (an alias default behind a model default), so every layer
 * is cleared unconditionally; a partial release would resurrect stale
 * defaults across later model or provider transitions.
 */
export function releaseEphemeralOwnership(config: object, key: string): void {
  const ownership = ownershipByConfig.get(config);
  if (ownership === undefined) {
    return;
  }
  const modelOwned = new Set(ownership.modelOwned);
  const providerOwned = new Map(ownership.providerOwned);
  const userOwned = new Set(ownership.userOwned);
  modelOwned.delete(key);
  providerOwned.delete(key);
  userOwned.delete(key);
  ownershipByConfig.set(config, { providerOwned, modelOwned, userOwned });
}
