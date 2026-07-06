/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dispose-time teardown helpers extracted from agentImpl.ts to keep that module
 * under the project's max-lines limit. These are pure structural guards over
 * the OAuthManager and the Config-owned extension loader; they hold no state.
 *
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */

import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/config.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';

/**
 * Defensively disposes an OAuthManager if it exposes a dispose method. The
 * runtime context cleanup (dispose.md line 55) normally owns this teardown; this
 * guard covers managers that are not torn down there.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 90-92
 */
export async function disposeOAuthManager(
  manager: OAuthManager,
): Promise<void> {
  const holder = manager as unknown as {
    dispose?: () => Promise<void> | void;
  };
  if (typeof holder.dispose === 'function') {
    await holder.dispose();
  }
}

/**
 * Structural view of the Config-owned extension loader's teardown surface. The
 * real ExtensionLoader (core/utils/extensionLoader.ts) exposes both methods;
 * this optional-method shape mirrors the disposeOAuthManager runtime-guard idiom
 * so a loader that does not surface them is skipped rather than crashing.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */
interface ExtensionTeardownSurface {
  getExtensions?: () => LlxprtExtension[];
  unloadExtension?: (extension: LlxprtExtension) => Promise<void> | void;
}

/**
 * Returns the active extensions known to the Config-owned loader. Defensively
 * guards the loader's getExtensions surface (mirroring disposeOAuthManager) and
 * filters to active extensions, since only active ones have started teardownable
 * MCP servers/context/commands/subagents (dispose.md line 80).
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 80
 */
export function collectActiveExtensions(loader: unknown): LlxprtExtension[] {
  const surface = loader as ExtensionTeardownSurface;
  if (typeof surface.getExtensions !== 'function') {
    return [];
  }
  return surface.getExtensions().filter((extension) => extension.isActive);
}

/**
 * Unloads a single extension through the loader's documented dynamic-unload path
 * (ExtensionLoader.unloadExtension), which stops the extension's MCP servers,
 * context, custom commands, and subagents. Defensively guards the unloadExtension
 * surface (mirroring disposeOAuthManager). A thrown unload propagates so the
 * caller's safe() collects it into errors[] (dispose.md line 80).
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 80
 */
export async function unloadExtensionSafely(
  loader: unknown,
  extension: LlxprtExtension,
): Promise<void> {
  const surface = loader as ExtensionTeardownSurface;
  if (typeof surface.unloadExtension === 'function') {
    await surface.unloadExtension(extension);
  }
}
