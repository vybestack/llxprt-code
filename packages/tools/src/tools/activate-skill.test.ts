/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivateSkillTool } from './activate-skill.js';
import type { ISkillService, SkillInfo } from '../interfaces/index.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';

describe('ActivateSkillTool', () => {
  let mockSkillService: ISkillService;
  let tool: ActivateSkillTool;
  const mockMessageBus = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as unknown as IToolMessageBus;

  beforeEach(() => {
    const skills: SkillInfo[] = [
      {
        name: 'test-skill',
        description: 'A test skill',
        location: '/path/to/test-skill/SKILL.md',
      },
    ];
    mockSkillService = {
      activateSkill: vi.fn().mockResolvedValue({
        success: true,
        instructions: 'Skill instructions content.',
        description: 'A test skill',
        location: '/path/to/test-skill/SKILL.md',
        folderStructure: 'Mock folder structure',
        resourceDirectory: '/path/to/test-skill',
      }),
      getSkillManager: vi.fn().mockReturnValue({
        getSkills: vi.fn().mockReturnValue(skills),
        getSkill: vi
          .fn()
          .mockImplementation((name: string) =>
            name === 'test-skill' ? skills[0] : null,
          ),
      }),
      listSkills: vi.fn().mockReturnValue(skills),
      getSkill: vi
        .fn()
        .mockImplementation((name: string) =>
          name === 'test-skill' ? skills[0] : null,
        ),
      getFolderStructure: vi.fn().mockResolvedValue('Mock folder structure'),
    } satisfies ISkillService;
    tool = new ActivateSkillTool(mockSkillService, mockMessageBus);
  });

  it('should return enhanced description', () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    expect(invocation.getDescription()).toBe('"test-skill": A test skill');
  });

  it('should return enhanced confirmation details', async () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const details = await invocation.shouldConfirmExecute(
      new AbortController().signal,
    );

    expect(details).not.toBe(false);
    if (details === false) throw new Error('unreachable: narrowing failed');
    expect(details.title).toBe('Activate Skill: test-skill');
    expect(details.prompt).toContain('enable the specialized agent skill');
    expect(details.prompt).toContain('A test skill');
    expect(details.prompt).toContain('Mock folder structure');
  });

  it('should activate a valid skill and return its content in XML tags', async () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(mockSkillService.activateSkill).toHaveBeenCalledWith('test-skill');
    expect(result.llmContent).toContain('<activated_skill name="test-skill">');
    expect(result.llmContent).toContain('<instructions>');
    expect(result.llmContent).toContain('Skill instructions content.');
    expect(result.llmContent).toContain('</instructions>');
    expect(result.llmContent).toContain('<available_resources>');
    expect(result.llmContent).toContain('Mock folder structure');
    expect(result.llmContent).toContain('</available_resources>');
    expect(result.llmContent).toContain('</activated_skill>');
    expect(result.returnDisplay).toContain('Skill **test-skill** activated');
    expect(result.returnDisplay).toContain('Mock folder structure');
  });

  it('should throw error if skill is not in enum', async () => {
    const params = { name: 'non-existent' };
    expect(() => tool.build(params as { name: string })).toThrow(Error);
  });

  it('should return an error if skill content cannot be read', async () => {
    vi.mocked(mockSkillService.activateSkill).mockResolvedValue({
      success: false,
      error: 'Skill "test-skill" not found. Available skills are: ',
      availableSkills: [],
    });
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Error: Skill "test-skill" not found.');
  });

  it('should validate that name is provided', () => {
    expect(() =>
      tool.build({ name: '' } as unknown as { name: string }),
    ).toThrow(Error);
  });
});
