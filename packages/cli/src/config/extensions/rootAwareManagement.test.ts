/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem-backed tests proving that extension management operations are
 * root-aware: they scan `.llxprt/extensions` first, then `.gemini/extensions`,
 * and always target the physical registration directory (not the link target
 * for linked extensions).
 *
 * Contract verified:
 * - `loadExtensionByName` finds extensions registered in `.gemini/extensions`.
 * - `uninstallExtension` removes the physical registration dir of a linked
 *   extension, not the link's source target.
 * - `enableExtension` / `disableExtension` resolve extensions registered in
 *   `.gemini/extensions`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadExtensionByName,
  uninstallExtension,
  disableExtension,
  EXTENSIONS_CONFIG_FILENAME_FALLBACK,
  INSTALL_METADATA_FILENAME,
} from '../extension.js';
import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../settings.js';

vi.mock('os', async (importOriginal) => {
  const mockedOs = await importOriginal<typeof os>();
  return {
    ...mockedOs,
    homedir: vi.fn(),
  };
});

vi.mock('../settings.js', () => ({
  loadSettings: vi.fn().mockReturnValue({ merged: {} }),
  SettingScope: {
    User: 'User',
    Workspace: 'Workspace',
  },
}));

const LLXPRT_EXT_SUBDIR = path.join(LLXPRT_CONFIG_DIR, 'extensions');
const COMPAT_EXT_SUBDIR = '.gemini/extensions';

describe('root-aware extension management', () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;
  let llxprtExtensionsDir: string;
  let compatExtensionsDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-aware-home-'));
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(tempHomeDir, 'root-aware-workspace-'),
    );
    llxprtExtensionsDir = path.join(tempHomeDir, LLXPRT_EXT_SUBDIR);
    compatExtensionsDir = path.join(tempHomeDir, COMPAT_EXT_SUBDIR);
    fs.mkdirSync(llxprtExtensionsDir, { recursive: true });
    fs.mkdirSync(compatExtensionsDir, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
    vi.spyOn(process, 'cwd').mockReturnValue(tempWorkspaceDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  });

  describe('loadExtensionByName root-aware lookup', () => {
    it('finds an extension registered in .llxprt/extensions', () => {
      const extDir = path.join(llxprtExtensionsDir, 'llxprt-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'llxprt-ext', version: '1.0.0' }),
      );

      const result = loadExtensionByName('llxprt-ext', tempWorkspaceDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('llxprt-ext');
    });

    it('finds an extension registered in .gemini/extensions (fallback root)', () => {
      const extDir = path.join(compatExtensionsDir, 'gemini-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'gemini-ext', version: '1.0.0' }),
      );

      const result = loadExtensionByName('gemini-ext', tempWorkspaceDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('gemini-ext');
    });

    it('prefers .llxprt/extensions when the same name exists in both roots', () => {
      const llxprtDir = path.join(llxprtExtensionsDir, 'shared-ext');
      fs.mkdirSync(llxprtDir, { recursive: true });
      fs.writeFileSync(
        path.join(llxprtDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'shared-ext', version: '2.0.0' }),
      );

      const compatDir = path.join(compatExtensionsDir, 'shared-ext');
      fs.mkdirSync(compatDir, { recursive: true });
      fs.writeFileSync(
        path.join(compatDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'shared-ext', version: '1.0.0' }),
      );

      const result = loadExtensionByName('shared-ext', tempWorkspaceDir);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('2.0.0');
    });
  });

  describe('uninstallExtension targets physical registration dir for linked extensions', () => {
    it('removes the registration symlink dir, not the link source target', async () => {
      // Create the source extension in a separate location.
      const sourceDir = path.join(tempHomeDir, 'source-ext');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'linked-ext', version: '1.0.0' }),
      );
      fs.writeFileSync(
        path.join(sourceDir, INSTALL_METADATA_FILENAME),
        JSON.stringify({ source: sourceDir, type: 'link' }),
      );

      // Register as a symlink in .llxprt/extensions/linked-ext
      const registrationDir = path.join(llxprtExtensionsDir, 'linked-ext');
      fs.symlinkSync(sourceDir, registrationDir, 'dir');

      // Verify the linked extension loads
      const loaded = loadExtensionByName('linked-ext', tempWorkspaceDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.installMetadata?.type).toBe('link');

      // Uninstall
      await uninstallExtension('linked-ext', false, tempWorkspaceDir);

      // The registration dir (symlink) must be removed
      expect(fs.existsSync(registrationDir)).toBe(false);
      // The source dir must NOT be removed — it is the link target, not the
      // physical registration
      expect(fs.existsSync(sourceDir)).toBe(true);
    });

    it('removes a physical extension from .gemini/extensions registration dir', async () => {
      const extDir = path.join(compatExtensionsDir, 'gemini-removable');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'gemini-removable', version: '1.0.0' }),
      );

      const loaded = loadExtensionByName('gemini-removable', tempWorkspaceDir);
      expect(loaded).not.toBeNull();

      await uninstallExtension('gemini-removable', false, tempWorkspaceDir);

      expect(fs.existsSync(extDir)).toBe(false);
    });
  });

  describe('enableExtension / disableExtension resolve .gemini/extensions roots', () => {
    it('disableExtension finds an extension registered in .gemini/extensions', () => {
      const extDir = path.join(compatExtensionsDir, 'enable-gemini-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'enable-gemini-ext', version: '1.0.0' }),
      );

      // Should not throw — the extension exists in .gemini/extensions
      expect(() =>
        disableExtension(
          'enable-gemini-ext',
          SettingScope.User,
          tempWorkspaceDir,
        ),
      ).not.toThrow();
    });
  });

  // ---- Finding 2: preserve exact physical registration identity ----

  describe('exact physical registration identity (case/source)', () => {
    it('uninstall by source URL removes only the matching registration, not a different same-name extension', async () => {
      // Two extensions with the same name but different sources/versions
      // in .llxprt/extensions (primary) and .gemini/extensions (compat)
      const llxprtDir = path.join(llxprtExtensionsDir, 'shared-ext');
      fs.mkdirSync(llxprtDir, { recursive: true });
      fs.writeFileSync(
        path.join(llxprtDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'shared-ext', version: '2.0.0' }),
      );
      fs.writeFileSync(
        path.join(llxprtDir, INSTALL_METADATA_FILENAME),
        JSON.stringify({
          source: 'https://llxprt.example.git',
          type: 'local',
        }),
      );

      const compatDir = path.join(compatExtensionsDir, 'shared-ext');
      fs.mkdirSync(compatDir, { recursive: true });
      fs.writeFileSync(
        path.join(compatDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'shared-ext', version: '1.0.0' }),
      );
      fs.writeFileSync(
        path.join(compatDir, '.gemini-extension-install.json'),
        JSON.stringify({
          source: 'https://gemini.example.git',
          type: 'local',
        }),
      );

      // Uninstall by the compat source URL — only the compat registration
      // must be removed, NOT the llxprt registration.
      await uninstallExtension(
        'https://gemini.example.git',
        false,
        tempWorkspaceDir,
      );

      // The compat dir should be gone
      expect(fs.existsSync(compatDir)).toBe(false);
      // The llxprt dir must NOT be removed
      expect(fs.existsSync(llxprtDir)).toBe(true);
    });

    it('case-variant uninstall name removes only the exact-case registration dir', async () => {
      // Extension registered with the exact dir name "MyExt"
      const primaryDir = path.join(llxprtExtensionsDir, 'MyExt');
      fs.mkdirSync(primaryDir, { recursive: true });
      fs.writeFileSync(
        path.join(primaryDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
      );

      // Another extension registered with dir name "myext" (different case)
      const otherDir = path.join(compatExtensionsDir, 'myext');
      fs.mkdirSync(otherDir, { recursive: true });
      fs.writeFileSync(
        path.join(otherDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'myext', version: '1.0.0' }),
      );

      // Uninstall "MyExt" — should NOT delete the "myext" registration
      await uninstallExtension('MyExt', false, tempWorkspaceDir);

      // MyExt should be gone
      expect(fs.existsSync(primaryDir)).toBe(false);
      // myext must NOT be removed
      expect(fs.existsSync(otherDir)).toBe(true);
    });
  });

  // ---- Finding: per-entry error resilience (OCR remediation) ----

  describe('per-entry error resilience', () => {
    it('loadExtensionByName continues past a broken symlink entry', () => {
      // Create a valid extension
      const validDir = path.join(llxprtExtensionsDir, 'valid-ext');
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(
        path.join(validDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'valid-ext', version: '1.0.0' }),
      );

      // Create a broken symlink that points to a nonexistent target
      const brokenDir = path.join(llxprtExtensionsDir, 'broken-link');
      fs.symlinkSync(
        path.join(tempHomeDir, 'does-not-exist'),
        brokenDir,
        'dir',
      );

      // loadExtensionByName must not throw and must find valid-ext
      const result = loadExtensionByName('valid-ext', tempWorkspaceDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('valid-ext');
    });

    it('loadExtensionByName continues past a malformed manifest entry', () => {
      // Create a valid extension
      const validDir = path.join(llxprtExtensionsDir, 'good-ext');
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(
        path.join(validDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'good-ext', version: '1.0.0' }),
      );

      // Create an extension with invalid JSON manifest
      const badDir = path.join(llxprtExtensionsDir, 'bad-ext');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(
        path.join(badDir, 'llxprt-extension.json'),
        '{ invalid json !!!',
      );

      // loadExtensionByName must not throw and must find good-ext
      const result = loadExtensionByName('good-ext', tempWorkspaceDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('good-ext');
    });

    it('uninstallExtension continues past a broken entry to find the target', async () => {
      // Create a valid extension
      const validDir = path.join(llxprtExtensionsDir, 'target-ext');
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(
        path.join(validDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'target-ext', version: '1.0.0' }),
      );

      // Create a broken symlink entry
      const brokenDir = path.join(llxprtExtensionsDir, 'broken-link');
      fs.symlinkSync(path.join(tempHomeDir, 'nonexistent'), brokenDir, 'dir');

      // Uninstall must find target-ext despite the broken entry
      await expect(
        uninstallExtension('target-ext', false, tempWorkspaceDir),
      ).resolves.toBeUndefined();
      expect(fs.existsSync(validDir)).toBe(false);
    });
  });

  // ---- Finding: source-targeted uninstall preserves physical identity ----

  describe('source-targeted case-variant uninstall preserves exact identity', () => {
    it('uninstall by name does not remove a different-case dir name with different manifest name', async () => {
      // Extension in llxprt with dir name "Alpha" and manifest name "Alpha"
      const alphaDir = path.join(llxprtExtensionsDir, 'Alpha');
      fs.mkdirSync(alphaDir, { recursive: true });
      fs.writeFileSync(
        path.join(alphaDir, 'llxprt-extension.json'),
        JSON.stringify({ name: 'Alpha', version: '1.0.0' }),
      );

      // Extension in compat with dir name "alpha" and manifest name "alpha"
      const alphaCompatDir = path.join(compatExtensionsDir, 'alpha');
      fs.mkdirSync(alphaCompatDir, { recursive: true });
      fs.writeFileSync(
        path.join(alphaCompatDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({ name: 'alpha', version: '1.0.0' }),
      );

      // Uninstall "Alpha" (capital) — should remove the llxprt registration,
      // NOT the compat "alpha" registration (different manifest name).
      await uninstallExtension('Alpha', false, tempWorkspaceDir);

      expect(fs.existsSync(alphaDir)).toBe(false);
      expect(fs.existsSync(alphaCompatDir)).toBe(true);
    });
  });
});
