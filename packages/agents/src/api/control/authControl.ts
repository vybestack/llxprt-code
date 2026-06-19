/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 *
 * AuthControl — owns the public auth surface: status, OAuth lifecycle
 * (enable/login/logout), buckets, mcpLogin, and setBaseUrl. Constructs an
 * AuthKeysControl internally (injected with the same auth-state deps).
 */

import type {
  AgentAuthControl,
  AgentAuthKeysControl,
  AuthBucket,
  AuthStatus,
} from '../agent.js';
import type { OAuthPromptHandler } from '../config-types.js';
import type { AgentAuthState } from './authState.js';
import { AuthKeysControl } from './authKeysControl.js';
import type { AuthKeysControlDeps } from './authKeysControl.js';

/**
 * Callback bundle injected by AgentImpl so AuthControl can read/mutate the
 * per-agent auth state and the live provider.
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export interface AuthControlDeps {
  /** The per-agent in-memory auth state. */
  readonly authState: AgentAuthState;
  /** Reads the current provider name (from providerState). */
  readonly getCurrentProvider: () => string;
  /** Reads the current keyName reference (from providerState). */
  readonly getKeyName: () => string | undefined;
  /** Computes the auth status for a provider (winner + oauth-aware). */
  readonly getStatus: (provider: string) => AuthStatus;
  /**
   * The onOAuthPrompt handler threaded from config (the interactive-OAuth
   * seam). Undefined when no handler was supplied.
   */
  readonly onOAuthPrompt: OAuthPromptHandler | undefined;
  /**
   * Sets/clears the baseUrl on providerState + the live provider (mirrors to
   * getProviderStatus). Wrapped in try/catch by the caller.
   */
  readonly setBaseUrl: (baseUrl: string | null) => Promise<void>;
  /** The deps bundle for the constructed AuthKeysControl. */
  readonly keysDeps: AuthKeysControlDeps;
}

/**
 * The public auth control. OAuth login flows through the onOAuthPrompt handler
 * (the interactive-OAuth seam that mirrors how the CLI drives OAuth). In
 * production runtimes the real token exchange is delegated to the OAuthManager;
 * the public contract under test is: handler-present ⇒ authenticated /
 * handler-absent ⇒ clear rejection. No real blocking device/browser OAuth flow
 * runs here (non-hermetic).
 *
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
export class AuthControl implements AgentAuthControl {
  readonly keys: AgentAuthKeysControl;

  constructor(private readonly deps: AuthControlDeps) {
    this.keys = new AuthKeysControl(deps.keysDeps);
  }

  /**
   * Synchronous auth status accessor for a provider (defaults to the current
   * provider). Delegates to the deps callback that computes the winner-based
   * status.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  status(provider?: string): AuthStatus {
    const resolved = provider ?? this.deps.getCurrentProvider();
    return this.deps.getStatus(resolved);
  }

  /**
   * Enables the OAuth path for a provider. Adds the provider to the
   * oauthEnabled set.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async enableOAuth(provider: string): Promise<void> {
    this.deps.authState.oauthEnabled.add(provider);
  }

  /**
   * Disables OAuth for a provider and clears any authenticated state.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async disableOAuth(provider: string): Promise<void> {
    this.deps.authState.oauthEnabled.delete(provider);
    this.deps.authState.oauthAuthenticated.delete(provider);
  }

  /**
   * The headless OAuth seam. Resolves the onOAuthPrompt handler threaded from
   * config. If no handler is present, throws a clear error. If present, calls
   * the handler with a constructed auth URL + provider and awaits its boolean;
   * truthy ⇒ marks the provider authenticated + seeds a default bucket; falsy
   * ⇒ throws a clear 'declined' error. Does NOT run a real blocking OAuth
   * device/browser flow (non-hermetic).
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async login(
    provider: string,
    opts?: { readonly bucket?: string },
  ): Promise<void> {
    const handler = this.deps.onOAuthPrompt;
    if (handler === undefined) {
      throw new Error(
        `OAuth login for provider "${provider}" requires an onOAuthPrompt handler`,
      );
    }
    const authUrl = `https://auth.llxprt.dev/${encodeURIComponent(provider)}/oauth`;
    const accepted = await handler({ url: authUrl, provider });
    if (!accepted) {
      throw new Error('OAuth login was declined');
    }
    this.deps.authState.oauthAuthenticated.add(provider);
    // Honor an explicit bucket: switchBucket creates-the-bucket-active and
    // deactivates others (works from an empty set). With no bucket arg, preserve
    // the existing semantics exactly — seed a single active 'default' bucket.
    if (opts?.bucket !== undefined) {
      await this.switchBucket(provider, opts.bucket);
    } else {
      this.seedDefaultBucket(provider);
    }
  }

  /**
   * Clears OAuth authentication for a provider. If opts.all, also clears
   * buckets for the provider.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async logout(
    provider: string,
    opts?: { readonly bucket?: string; readonly all?: boolean },
  ): Promise<void> {
    this.deps.authState.oauthAuthenticated.delete(provider);
    if (opts?.all === true) {
      this.deps.authState.buckets.delete(provider);
      return;
    }
    // When a specific bucket is named (and not `all`), remove just that bucket
    // from the provider's list, leaving the others intact. Plain logout (no
    // bucket, no all) clears auth but preserves all buckets.
    if (opts?.bucket !== undefined) {
      const existing = this.deps.authState.buckets.get(provider);
      if (existing !== undefined) {
        this.deps.authState.buckets.set(
          provider,
          existing.filter((b) => b.name !== opts.bucket),
        );
      }
    }
  }

  /**
   * Synchronous: returns the session buckets for a provider (defaults to the
   * current provider). Empty array when none.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  listBuckets(provider?: string): readonly AuthBucket[] {
    const resolved = provider ?? this.deps.getCurrentProvider();
    return this.deps.authState.buckets.get(resolved) ?? [];
  }

  /**
   * Marks the named bucket active for a provider (sets .active=true on it,
   * false on others). Creates the bucket if absent.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async switchBucket(provider: string, bucket: string): Promise<void> {
    const existing = this.deps.authState.buckets.get(provider) ?? [];
    const hasBucket = existing.some((b) => b.name === bucket);
    const updated: AuthBucket[] = existing.map((b) => ({
      ...b,
      active: b.name === bucket,
    }));
    if (!hasBucket) {
      updated.push({ name: bucket, provider, active: true });
    }
    this.deps.authState.buckets.set(provider, updated);
  }

  /**
   * Marks an MCP server as authenticated (the per-server auth flow).
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async mcpLogin(server: string): Promise<void> {
    this.deps.authState.mcpAuth.add(server);
  }

  /**
   * Sets/clears the baseUrl on the auth state + mirrors onto providerState and
   * the live provider via the real mutator (try/catch — safe no-op under the
   * fake seam).
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  async setBaseUrl(
    baseUrl: string | null,
    opts?: { readonly provider?: string },
  ): Promise<void> {
    // setBaseUrl mutates the CURRENT provider context only. If a different
    // provider is requested, throw rather than silently updating the wrong one.
    if (opts?.provider !== undefined) {
      const current = this.deps.getCurrentProvider();
      if (opts.provider !== current) {
        throw new Error(
          `setBaseUrl can only target the active provider "${current}", but provider "${opts.provider}" was requested`,
        );
      }
    }
    this.deps.authState.baseUrl = baseUrl ?? undefined;
    await this.deps.setBaseUrl(baseUrl);
  }

  /**
   * Seeds a default active bucket for a provider after a successful OAuth
   * login so listBuckets returns a non-empty array.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private seedDefaultBucket(provider: string): void {
    if (this.deps.authState.buckets.has(provider)) {
      return;
    }
    const defaultBucket: AuthBucket = {
      name: 'default',
      provider,
      active: true,
    };
    this.deps.authState.buckets.set(provider, [defaultBucket]);
  }
}
