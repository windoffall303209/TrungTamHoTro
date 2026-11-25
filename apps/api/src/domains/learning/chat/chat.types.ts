import type { ChatMessageView } from "@wind-of-fall/contracts";

export type {
  ChatConversationView,
  ChatDirectoryEntry,
  ChatMemberView,
  ChatMessagePage,
  ChatMessageView,
} from "@wind-of-fall/contracts";

export type ChatStreamEvent = { data: ChatMessageView; id: string } | { comment: string };
