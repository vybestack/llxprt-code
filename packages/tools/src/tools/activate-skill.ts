/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ToolResult,
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolConfirmationOutcome,
} from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { IToolMessageBus, ISkillService } from '../interfaces/index.js';
import { ACTIVATE_SKILL_TOOL_NAME } from '../types/tool-names.js';
import { ToolErrorType } from '../types/tool-error.js';

/**
 * Parameters for the ActivateSkill tool
 */
export interface ActivateSkillToolParams {
  /**
   * The name of the skill to activate
   */
  name: string;
}

class ActivateSkillToolInvocation extends BaseToolInvocation<
  ActivateSkillToolParams,
  ToolResult
> {
  private cachedFolderStructure: string | undefined;

  constructor(
    private readonly skillService: ISkillService,
    params: ActivateSkillToolParams,
    messageBus: IToolMessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    const skillName = this.params.name;
    const skill = this.skillService.getSkill(skillName);
    if (skill) {
      return `"${skillName}": ${skill.description}`;
    }
    return `"${skillName}" (?) unknown skill`;
  }

  private async getOrFetchFolderStructure(skillName: string): Promise<string> {
    this.cachedFolderStructure ??=
      await this.skillService.getFolderStructure(skillName);
    return this.cachedFolderStructure;
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (!this.messageBus) {
      return false;
    }

    const skillName = this.params.name;
    const skill = this.skillService.getSkill(skillName);

    if (!skill) {
      return false;
    }

    const folderStructure = await this.getOrFetchFolderStructure(skillName);

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Activate Skill: ${skillName}`,
      prompt: `You are about to enable the specialized agent skill **${skillName}**.

**Description:**
${skill.description ?? ''}

**Resources to be shared with the model:**
${folderStructure}`,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
    return confirmationDetails;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const skillName = this.params.name;
    const result = await this.skillService.activateSkill(skillName);

    if (!result.success) {
      const availableSkills = result.availableSkills?.join(', ') ?? '';
      const errorMessage =
        result.error ??
        `Skill "${skillName}" not found. Available skills are: ${availableSkills}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const folderStructure =
      result.folderStructure ??
      (await this.getOrFetchFolderStructure(skillName));

    return {
      llmContent: `<activated_skill name="${skillName}">
  <instructions>
    ${result.instructions ?? ''}
  </instructions>

  <available_resources>
    ${folderStructure}
  </available_resources>
</activated_skill>`,
      returnDisplay: `Skill **${skillName}** activated. Resources loaded from \`${result.resourceDirectory ?? ''}\`:\n\n${folderStructure}`,
    };
  }
}

/**
 * Implementation of the ActivateSkill tool logic
 */
export class ActivateSkillTool extends BaseDeclarativeTool<
  ActivateSkillToolParams,
  ToolResult
> {
  static readonly Name = ACTIVATE_SKILL_TOOL_NAME;

  constructor(
    private readonly skillService: ISkillService,
    messageBus: IToolMessageBus,
  ) {
    const skills = skillService.listSkills();
    const skillNames = skills.map((s) => s.name);

    let schema: z.ZodTypeAny;
    if (skillNames.length === 0) {
      schema = z.object({
        name: z.string().describe('No skills are currently available.'),
      });
    } else {
      schema = z.object({
        name: z
          .enum(skillNames as [string, ...string[]])
          .describe('The name of the skill to activate.'),
      });
    }

    const availableSkillsHint =
      skillNames.length > 0
        ? ` (Available: ${skillNames.map((n) => `'${n}'`).join(', ')})`
        : '';

    super(
      ActivateSkillTool.Name,
      'Activate Skill',
      `Activates a specialized agent skill by name${availableSkillsHint}. Returns the skill's instructions wrapped in \`<activated_skill>\` tags. These provide specialized guidance for the current task. Use this when you identify a task that matches a skill's description. ONLY use names exactly as they appear in the \`<available_skills>\` section.`,
      Kind.Other,
      zodToJsonSchema(schema),
      true,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: ActivateSkillToolParams,
    messageBus: IToolMessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ActivateSkillToolParams, ToolResult> {
    return new ActivateSkillToolInvocation(
      this.skillService,
      params,
      messageBus,
      _toolName,
      _toolDisplayName ?? 'Activate Skill',
    );
  }
}
