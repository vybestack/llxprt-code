import { IMessage, ITool } from '../index.js';

export interface IChatGenerateParams {
  messages: IMessage[];
  tools?: ITool[];
  stream?: boolean;
  conversationId?: string;
  parentId?: string;
  tool_choice?: string | object;
  stateful?: boolean;
}
