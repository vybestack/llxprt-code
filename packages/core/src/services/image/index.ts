/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type {
  ImageGenerateRequest,
  ImageResult,
  ImageGenerationBackend,
  ImageGenerationService,
} from './ImageGenerationService.js';
export {
  ImageGenerationError,
  ImageValidationError,
  ImagePersistenceError,
  validateImagePrompt,
  persistBase64ImageResult,
  strictBase64Decode,
  validatePngStructure,
} from './ImageGenerationService.js';

export type {
  ImageOperation,
  ImageOperationRequest,
  ImageOperationInput,
  ImageBackendResult,
  ImageOperationResult,
  ImageOperationBackend,
} from './imageOperation.js';
export {
  ImageOperationError,
  buildNormalizedImageRequest,
  resolveOutputPath,
  resolveInputPaths,
  writeImageAtomically,
  MAX_INPUT_IMAGES,
} from './imageOperation.js';

export type {
  ImageOperationBackendResolver,
  ImageOperationDispatchDeps,
} from './imageOperationDispatch.js';
export { runImageOperation } from './imageOperationDispatch.js';

export type {
  ImageOperationRunner,
  ImageOperationRunnerInput,
  ImageOperationRunnerResult,
} from './imageCapability.js';
