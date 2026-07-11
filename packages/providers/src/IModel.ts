/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface IModel {
  id: string;
  name: string;
  provider: string;
  supportedToolFormats: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  /**
   * Field-specific geometry authority markers. When a field is marked
   * `true`, the model's own value is authoritative and must NOT be
   * overridden by registry data during hydration. Internal marker — not
   * surfaced to the UI.
   *
   * @issue #2483
   */
  geometryAuthority?: {
    contextWindow?: boolean;
    maxOutputTokens?: boolean;
  };
}
