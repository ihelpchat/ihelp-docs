import { parseAssistantReply } from '../architecture/conversation-v1.mjs';
import type { AssistantReplyV1 } from './conversation-contract.generated';

/** O cliente usa o mesmo validador fechado do servidor. */
export function validateConversationReply(value: unknown): AssistantReplyV1 {
  return parseAssistantReply(value) as AssistantReplyV1;
}
