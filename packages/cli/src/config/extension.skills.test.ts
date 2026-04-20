/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadExtension,
  ExtensionStorage,
  loadExtensions,
} from './extension.js';
import { createExtension } from '../test-utils/createExtension.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

vi.mock('os', async (importOriginal) => {
  const mockedOs = await importOriginal<typeof os>();
  return {
    ...mockedOs,
    homedir: vi.fn(),
  };
});

vi.mock('./trustedFolders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trustedFolders.js')>();
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    logExtensionEnable: vi.fn(),
    logExtensionInstallEvent: vi.fn(),
    logExtensionUninstall: vi.fn(),
    logExtensionDisable: vi.fn(),
    ExtensionEnableEvent: vi.fn(),
    ExtensionInstallEvent: vi.fn(),
    ExtensionUninstallEvent: vi.fn(),
    ExtensionDisableEvent: vi.fn(),
  };
});

describe('extension skills loading', () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;
  let userExtensionsDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-ext-skills-test-home-'),
    );
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(tempHomeDir, 'llxprt-ext-skills-test-workspace-'),
    );
    const EXTENSIONS_DIRECTORY_NAME = path.join('.llxprt', 'extensions');
    userExtensionsDir = path.join(tempHomeDir, EXTENSIONS_DIRECTORY_NAME);
    fs.mkdirSync(userExtensionsDir, { recursive: true });

    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should return empty skills when extension has no skills directory', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'no-skills-ext',
      version: '1.0.0',
    });

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toStrictEqual([]);
  });

  it('should load skills from a skills subdirectory', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'skills-ext',
      version: '1.0.0',
    });

    const skillsDir = path.join(extensionDir, 'skills', 'test-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\n---\nDo the thing.',
    );

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toHaveLength(1);
    expect(extension!.skills![0].name).toBe('test-skill');
    expect(extension!.skills![0].description).toBe('A test skill');
    expect(extension!.skills![0].body).toBe('Do the thing.');
    expect(extension!.skills![0].location).toBe(
      path.join(skillsDir, 'SKILL.md'),
    );
  });

  it('should load multiple skills from an extension', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'multi-skills-ext',
      version: '1.0.0',
    });

    const skill1Dir = path.join(extensionDir, 'skills', 'skill-alpha');
    const skill2Dir = path.join(extensionDir, 'skills', 'skill-beta');
    fs.mkdirSync(skill1Dir, { recursive: true });
    fs.mkdirSync(skill2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(skill1Dir, 'SKILL.md'),
      '---\nname: skill-alpha\ndescription: First skill\n---\nAlpha body.',
    );
    fs.writeFileSync(
      path.join(skill2Dir, 'SKILL.md'),
      '---\nname: skill-beta\ndescription: Second skill\n---\nBeta body.',
    );

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toHaveLength(2);
    const names = extension!.skills!.map((s) => s.name).sort();
    expect(names).toStrictEqual(['skill-alpha', 'skill-beta']);
  });

  it('should return empty skills when skills directory exists but has no valid SKILL.md files', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'empty-skills-ext',
      version: '1.0.0',
    });

    const skillsDir = path.join(extensionDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'not-a-skill.txt'), 'hello');

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toStrictEqual([]);
  });

  it('should skip SKILL.md files with invalid frontmatter', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'bad-frontmatter-ext',
      version: '1.0.0',
    });

    const skillDir = path.join(extensionDir, 'skills', 'bad-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      'No frontmatter here, just content.',
    );

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toStrictEqual([]);
  });

  it('should make skills available through loadExtensions', () => {
    createExtension({
      extensionsDir: userExtensionsDir,
      name: 'discoverable-skills-ext',
      version: '1.0.0',
    });

    const skillDir = path.join(
      userExtensionsDir,
      'discoverable-skills-ext',
      'skills',
      'my-skill',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: Discovered skill\n---\nSkill body.',
    );

    const extensions = loadExtensions(
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      tempWorkspaceDir,
    );

    expect(extensions).toHaveLength(1);
    expect(extensions[0].skills).toHaveLength(1);
    expect(extensions[0].skills![0].name).toBe('my-skill');
  });

  it('should apply variable hydration to skill content', () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'hydrated-skills-ext',
      version: '1.0.0',
    });

    const skillDir = path.join(extensionDir, 'skills', 'path-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: path-skill\ndescription: Uses extension path\n---\nLook in ${extensionPath} for files.',
    );

    const extension = loadExtension({
      extensionDir,
      workspaceDir: tempWorkspaceDir,
    });

    expect(extension).not.toBeNull();
    expect(extension!.skills).toHaveLength(1);
    expect(extension!.skills![0].body).toBe(
      `Look in ${extensionDir} for files.`,
    );
  });
});
