/**
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */

import type { ApiKeyUpdateResult } from '@vybestack/llxprt-code-core';
import type { AgentAuthKeysControl, KeyInfo } from '../agent.js';
import type { AgentAuthState } from './authState.js';

/**
 * Callback bundle injected by AgentImpl so AuthKeysControl can mutate the
 * per-agent auth state and drive the live provider key mutator without holding
 * a back-reference to the whole AgentImpl.
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export interface AuthKeysControlDeps {
  /** The per-agent in-memory auth state (keyStore lives here). */
  readonly authState: AgentAuthState;
  /** Reads the current keyName reference from providerState. */
  readonly getKeyName: () => string | undefined;
  /**
   * Sets/clears the keyName reference on providerState (the single source of
   * truth for the keyName winner). Called by use(name)/delete(name).
   */
  readonly setKeyName: (keyName: string | undefined) => void;
  readonly updateProviderApiKey: (
    apiKey: string | null,
  ) => Promise<ApiKeyUpdateResult>;
}

/**
 * In-memory named-key store + raw-key setter. The secret value lives ONLY in
 * the per-agent authState.keyStore map and is NEVER copied onto providerState
 * or into any ProviderStatus/ProfileDetail object. Only the key *reference*
 * (name) surfaces.
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export class AuthKeysControl implements AgentAuthKeysControl {
  constructor(private readonly deps: AuthKeysControlDeps) {}

  /**
   * Returns the list of named keys in the in-memory store (name only — never
   * the secret value).
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async list(): Promise<readonly KeyInfo[]> {
    const names = Array.from(this.deps.authState.keyStore.keys());
    return names.map((name) => ({ name }));
  }

  /**
   * Saves a named secret to the in-memory store. Validates name non-empty.
   * Does NOT set the keyName reference (saving ≠ using). In-memory only — the
   * value never touches disk or the host keychain.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async save(
    name: string,
    apiKey: string,
    _opts?: { readonly provider?: string },
  ): Promise<void> {
    if (name.length === 0) {
      throw new Error('Key name must be non-empty');
    }
    this.deps.authState.keyStore.set(name, apiKey);
  }

  /**
   * Sets the named-key REFERENCE as the active key source (becomes the winner
   * when no raw key is present). Does NOT set rawKeyPresent. Optionally, if the
   * named secret exists in the store, pushes it to the live provider via the
   * real mutator (try/catch — safe no-op under the fake seam). NEVER places the
   * secret on providerState/status.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async use(
    name: string,
    _opts?: { readonly provider?: string },
  ): Promise<void> {
    if (name.length === 0) {
      throw new Error('Key name must be non-empty');
    }
    this.deps.setKeyName(name);
    const secret = this.deps.authState.keyStore.get(name);
    if (secret !== undefined) {
      try {
        await this.deps.updateProviderApiKey(secret);
      } catch {
        // No-op under the fake seam or if the provider rejects it.
      }
    }
  }

  /**
   * Removes the named secret from the in-memory store. If providerState.keyName
   * matches the deleted name, clears it so the winner falls through.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async delete(
    name: string,
    _opts?: { readonly provider?: string },
  ): Promise<void> {
    this.deps.authState.keyStore.delete(name);
    if (this.deps.getKeyName() === name) {
      this.deps.setKeyName(undefined);
    }
  }

  async setRaw(
    apiKey: string | null,
    _opts?: { readonly provider?: string },
  ): Promise<ApiKeyUpdateResult> {
    const result = await this.deps.updateProviderApiKey(apiKey);
    this.deps.authState.rawKeyPresent = Boolean(apiKey?.trim());
    return result;
  }

  /**
   * Sets/clears the keyfile path on the auth state.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async setKeyFile(
    path: string | null,
    _opts?: { readonly provider?: string },
  ): Promise<void> {
    this.deps.authState.keyFile = path ?? undefined;
  }
}
