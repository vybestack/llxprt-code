import { loadSettings } from '../../config/settings.js';
import { debugLogger } from '@vybestack/llxprt-code-core';
import type { CommandModule } from 'yargs';
import { exitCli } from '../utils.js';
import { enableSkill } from '../../utils/skillSettings.js';
import { renderSkillActionFeedback } from '../../utils/skillUtils.js';

interface EnableArgs {
  name: string;
}

export async function handleEnable(args: EnableArgs) {
  const { name } = args;
  const workspaceDir = process.cwd();
  const settings = loadSettings(workspaceDir);

  const result = enableSkill(settings, name);
  debugLogger.log(renderSkillActionFeedback(result, (label, _path) => label));
}

export const enableCommand: CommandModule = {
  command: 'enable <name>',
  describe: 'Enables an agent skill.',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'The name of the skill to enable.',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    await handleEnable({
      name: argv['name'] as string,
    });
    await exitCli();
  },
};
