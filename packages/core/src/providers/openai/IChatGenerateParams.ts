import { type IContent } from '../../services/history/IContent.js';

export interface IChatGenerateParams {
  content: IContent[];
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: unknown;
    }>;
  }>;
  stream?: boolean;
  conversationId?: string;
  parentId?: string;
  tool_choice?: string | object;
  stateful?: boolean;
}
