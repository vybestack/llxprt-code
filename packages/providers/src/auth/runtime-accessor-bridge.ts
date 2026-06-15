/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-owned runtime-accessor seam for the OAuth/auth cluster.
 *
 * This is the dependency-inversion bridge that replaces the former
 * dynamic import of CLI runtime settings inside the moved auth cluster.
 * The CLI registers concrete
 * accessors at startup via {@link oauthRuntimeBridge.setAccessors};
 * the providers package only depends on this self-contained module.
 *
 * Design mirrors `packages/auth/src/oauth-ui-bridge.ts` (Phase 1):
 *   - Pure module, never imports core or cli.
 *   - A settable singleton with safe defaults.
 *
 * Defaults (when no accessors are registered) match the old dynamic-import
 * `catch` path: the import failed → code used fallback defaults.
 *   - getEphemeralSetting → undefined
 *   - getProviderManager   → undefined
 *   - getRuntimeContext    → undefined
 *   - getCurrentProfileName → null
 *
 * `getRuntimeContext` is the ONE exception: the old `getCliRuntimeContext()`
 * could throw, and callers (e.g. auth-status-service) wrapped it in their own
 * inner try/catch.  The bridge preserves this — if the registered accessor
 * throws, the bridge propagates the error so callers can catch it.
 */

/**
 * Narrow interface describing the runtime accessors the auth cluster needs.
 * Implemented by the CLI side via buildOAuthRuntimeAccessors().
 */
export interface OAuthRuntimeAccessors {
  /** Read an ephemeral setting by key (returns undefined when unset). */
  getEphemeralSetting(key: string): unknown;
  /** Obtain the CLI provider manager, or undefined when unavailable. */
  getProviderManager():
    | { getProviderByName(name: string): unknown }
    | undefined;
  /**
   * Obtain the CLI runtime context.
   * MAY throw when the runtime is not initialized — callers are expected
   * to wrap this in their own try/catch (matching the old dynamic-import path).
   */
  getRuntimeContext(): { runtimeId?: string } | undefined;
  /** Resolve the current profile name, or null when unavailable. */
  getCurrentProfileName(): string | null;
}

/**
 * Settable singleton registry.  CLI startup calls `setAccessors` once;
 * all auth-cluster code reads through the delegate methods.
 */
class OAuthRuntimeBridge {
  private accessors: OAuthRuntimeAccessors | undefined;

  /** Register (or clear with undefined) the concrete accessors. */
  setAccessors(accessors: OAuthRuntimeAccessors | undefined): void {
    this.accessors = accessors;
  }

  private requireAccessors(): OAuthRuntimeAccessors {
    const accessors = this.accessors;
    if (!accessors) {
      throw new Error(
        'OAuth runtime accessors are not registered. The CLI/runtime ' +
          'composition root must call oauthRuntimeBridge.setAccessors() ' +
          'before the OAuth/auth cluster reads runtime state.',
      );
    }
    return accessors;
  }

  /**
   * Delegate to the registered accessor.
   *
   * When no accessor is registered, THROWS — preserving the behaviour of the
   * former dynamic import of CLI `runtimeSettings.getEphemeralSetting`, which
   * routed through `getCliRuntimeServices()` and threw when no runtime was
   * active. Every consumer wraps this in its own try/catch and falls back to
   * a default, so the throw reproduces the original control flow exactly.
   */
  getEphemeralSetting(key: string): unknown {
    return this.requireAccessors().getEphemeralSetting(key);
  }

  /**
   * Delegate to the registered accessor.
   *
   * When no accessor is registered, THROWS — preserving the behaviour of the
   * former `getCliProviderManager()` / `getCliRuntimeServices()` which threw
   * when no runtime was active. Consumers wrap this in try/catch.
   */
  getProviderManager():
    | { getProviderByName(name: string): unknown }
    | undefined {
    return this.requireAccessors().getProviderManager();
  }

  /**
   * Delegate to the registered accessor.
   *
   * When no accessor is registered, THROWS — preserving the behaviour of the
   * former `getCliRuntimeContext()`, which threw when no runtime was active.
   * Consumers (e.g. auth-status-service) wrap this in their own try/catch.
   */
  getRuntimeContext(): { runtimeId?: string } | undefined {
    return this.requireAccessors().getRuntimeContext();
  }

  /**
   * Delegate to the registered accessor.
   *
   * When no accessor is registered, THROWS — preserving the behaviour of the
   * former `getCliRuntimeServices()` settings read, which threw when no
   * runtime was active. Consumers wrap this in try/catch and fall back to null.
   */
  getCurrentProfileName(): string | null {
    return this.requireAccessors().getCurrentProfileName();
  }
}

/** Singleton bridge instance. */
export const oauthRuntimeBridge = new OAuthRuntimeBridge();
