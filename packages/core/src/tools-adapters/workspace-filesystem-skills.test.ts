import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import { ActivateSkillTool, ReadFileTool } from '@vybestack/llxprt-code-tools';
import { Config } from '../config/config.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { WorkspaceSkillOwner } from '../skills/workspace-skill-owner.js';
import { CoreSkillServiceAdapter } from './CoreSkillServiceAdapter.js';
import { CoreToolHostAdapter } from './CoreToolHostAdapter.js';

describe('real skill resources and filesystem admission @issue:2615', () => {
  let directory = '';
  let target = '';
  let resources = '';
  let trusted = true;
  let disabled: string[] = [];
  let filesystem: WorkspaceFilesystemOwner;
  let skills: WorkspaceSkillOwner;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'filesystem-skills-2615-')),
    );
    target = path.join(directory, 'workspace');
    const catalogue = path.join(directory, 'catalogue');
    resources = path.join(catalogue, '.agents', 'skills', 'file-resource');
    await mkdir(target);
    await mkdir(resources, { recursive: true });
    await writeFile(
      path.join(resources, 'SKILL.md'),
      '---\nname: file-resource\ndescription: Read the real resource\n---\nUse data.txt from this skill.',
    );
    await writeFile(path.join(resources, 'data.txt'), 'skill resource content');
    trusted = true;
    disabled = [];
    filesystem = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => trusted,
    });
    settingsOwner = new SessionSettingsOwner(new SettingsService());
    config = new Config({
      targetDir: target,
      cwd: target,
      sessionId: 'same-label',
      model: 'test',
      debugMode: false,
    });
    skills = new WorkspaceSkillOwner({
      directories: {
        userSkillsDir: Storage.getUserSkillsDir(),
        userAgentSkillsDir: Storage.getUserAgentSkillsDir(),
        projectSkillsDir: new Storage(catalogue).getProjectSkillsDir(),
        projectAgentSkillsDir: new Storage(
          catalogue,
        ).getProjectAgentSkillsDir(),
      },
      enabled: () => true,
      readExtensions: () => [],
      readPolicy: () => ({
        disabledSkills: [...disabled],
        adminSkillsEnabled: true,
      }),
      applyPolicy: (policy) => {
        disabled = [...policy.disabledSkills];
      },
      reloadPolicy: async () => ({}),
      isTrusted: () => trusted,
      notifyDirectoriesChanged: () => filesystem.notifyTrustChanged(),
      addDirectory: (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      acceptPublication: () => ({
        rebuild: () => () => {},
        publish: async () => {},
        release: () => {},
      }),
    });
    await skills.initialize();
  });
  afterEach(async () => {
    await skills.dispose();
    await filesystem.dispose();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('admits a resource directory only after actual public skill activation', async () => {
    const host = new CoreToolHostAdapter(
      config,
      filesystem.paths,
      filesystem.files,
      filesystem.ignore,
      filesystem.scans,
      () => settingsOwner.readToolExecutionPolicy(),
      { isTrustedFolder: () => trusted, getIdeTrust: () => undefined },
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    );
    const read = new ReadFileTool(host);
    const file = path.join(resources, 'data.txt');
    expect(() => read.build({ absolute_path: file })).toThrow('workspace');
    const tool = new ActivateSkillTool(
      new CoreSkillServiceAdapter(skills.operations),
      {
        requestConfirmation: async () => {
          throw new Error('Unexpected confirmation request');
        },
      },
    );
    const result = await tool
      .build({ name: 'file-resource' })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Use data.txt');
    expect(
      (
        await read
          .build({ absolute_path: file })
          .execute(new AbortController().signal)
      ).llmContent,
    ).toContain('skill resource content');
    disabled = ['file-resource'];
    expect(() => read.build({ absolute_path: file })).toThrow('workspace');
  });

  it('does not leak a project resource directory after untrusted activation is denied', async () => {
    trusted = false;
    const result = await skills.operations.activate('file-resource');
    expect(result.success).toBe(false);
    trusted = true;
    expect(filesystem.paths.contains(resources)).toBe(false);
  });

  it('does not leak resources merely by preparing a public approval prompt', async () => {
    const tool = new ActivateSkillTool(
      new CoreSkillServiceAdapter(skills.operations),
      {
        requestConfirmation: async () => {
          throw new Error('Unexpected confirmation request');
        },
      },
    );
    const prompt = await tool
      .build({ name: 'file-resource' })
      .shouldConfirmExecute(new AbortController().signal);
    expect(prompt).not.toBe(false);
    expect(filesystem.paths.contains(resources)).toBe(false);
  });
});
