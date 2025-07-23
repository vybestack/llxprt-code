import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';

export interface IChatGenerateParams {
  messages: IMessage[];
  tools?: ITool[];
  stream?: boolean;
  conversationId?: string;
  parentId?: string;
  tool_choice?: string | object;
  stateful?: boolean;
}
