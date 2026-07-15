/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import semver from 'semver';
import { getErrorMessage } from '../../utils/errors.js';
import {
  loadExtensionConfig,
  validateName,
  EXTENSIONS_CONFIG_FILENAME,
  EXTENSIONS_CONFIG_FILENAME_FALLBACK,
} from '../../config/extension.js';
import { exitCli } from '../utils.js';
import { resolveSecureContextPath } from '../../config/extensions/extensionLoader.js';

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
    await exitCli(1);
  }
}

/**
 * Determines which manifest file was selected by the precedence rule
 * (llxprt-extension.json first, then gemini-extension.json). Returns the
 * filename for use in diagnostics so error messages name the correct manifest.
 */
function resolveSelectedManifestName(extensionDir: string): string {
  if (fs.existsSync(path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME))) {
    return EXTENSIONS_CONFIG_FILENAME;
  }
  return EXTENSIONS_CONFIG_FILENAME_FALLBACK;
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
    await exitCli(1);
  }

  const selectedManifestName = resolveSelectedManifestName(absoluteInputPath);

  const extensionConfig = await loadExtensionConfig({
    extensionDir: absoluteInputPath,
    workspaceDir,
  });
  if (!extensionConfig) {
    throw new Error(
      `Invalid extension at ${absoluteInputPath}. Please make sure it has a valid ${EXTENSIONS_CONFIG_FILENAME} or ${EXTENSIONS_CONFIG_FILENAME_FALLBACK} file.`,
    );
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  if (extensionConfig.contextFileName != null) {
    const contextFileNames = Array.isArray(extensionConfig.contextFileName)
      ? extensionConfig.contextFileName
      : [extensionConfig.contextFileName];

    const missingContextFiles: string[] = [];
    for (const contextFilePath of contextFileNames) {
      const contextFileAbsolutePath = resolveSecureContextPath(
        contextFilePath,
        absoluteInputPath,
      );
      if (
        contextFileAbsolutePath === null ||
        !fs.existsSync(contextFileAbsolutePath)
      ) {
        missingContextFiles.push(contextFilePath);
      }
    }
    if (missingContextFiles.length > 0) {
      errors.push(
        `The following context files referenced in ${selectedManifestName} are missing: ${missingContextFiles}`,
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
    await exitCli();
  },
};
