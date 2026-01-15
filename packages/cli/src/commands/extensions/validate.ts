/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import semver from 'semver';
import { getErrorMessage } from '../../utils/errors.js';
import { loadExtensionConfig, validateName } from '../../config/extension.js';

const debugLogger = DebugLogger.getLogger('llxprt:extensions:validate');

interface ValidateArgs {
  path: string;
}

export async function handleValidate(args: ValidateArgs) {
  try {
    await validateExtension(args);
    debugLogger.log(`Extension ${args.path} has been successfully validated.`);
  } catch (error) {
    debugLogger.error(getErrorMessage(error));
    process.exit(1);
  }
}

async function validateExtension(args: ValidateArgs) {
  const workspaceDir = process.cwd();
  const absoluteInputPath = path.resolve(args.path);

  // Validate extension name from the path
  const extensionName = path.basename(absoluteInputPath);
  try {
    validateName(extensionName);
  } catch (e) {
    debugLogger.error(getErrorMessage(e));
    process.exit(1);
  }

  const extensionConfig = await loadExtensionConfig({
    extensionDir: absoluteInputPath,
    workspaceDir,
  });
  if (!extensionConfig) {
    throw new Error(
      `Invalid extension at ${absoluteInputPath}. Please make sure it has a valid llxprt-extension.json or gemini-extension.json file.`,
    );
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  if (extensionConfig.contextFileName) {
    const contextFileNames = Array.isArray(extensionConfig.contextFileName)
      ? extensionConfig.contextFileName
      : [extensionConfig.contextFileName];

    const missingContextFiles: string[] = [];
    for (const contextFilePath of contextFileNames) {
      const contextFileAbsolutePath = path.resolve(
        absoluteInputPath,
        contextFilePath,
      );
      if (!fs.existsSync(contextFileAbsolutePath)) {
        missingContextFiles.push(contextFilePath);
      }
    }
    if (missingContextFiles.length > 0) {
      errors.push(
        `The following context files referenced in gemini-extension.json are missing: ${missingContextFiles}`,
      );
    }
  }

  if (!semver.valid(extensionConfig.version)) {
    warnings.push(
      `Warning: Version '${extensionConfig.version}' does not appear to be standard semver (e.g., 1.0.0).`,
    );
  }

  if (warnings.length > 0) {
    debugLogger.warn('Validation warnings:');
    for (const warning of warnings) {
      debugLogger.warn(`  - ${warning}`);
    }
  }

  if (errors.length > 0) {
    debugLogger.error('Validation failed with the following errors:');
    for (const error of errors) {
      debugLogger.error(`  - ${error}`);
    }
    throw new Error('Extension validation failed.');
  }
}

export const validateCommand: CommandModule = {
  command: 'validate <path>',
  describe: 'Validates an extension from a local path.',
  builder: (yargs) =>
    yargs.positional('path', {
      describe: 'The path of the extension to validate.',
      type: 'string',
      demandOption: true,
    }),
  handler: async (args) => {
    await handleValidate({
      path: args['path'] as string,
    });
  },
};
