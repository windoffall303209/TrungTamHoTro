export interface ChatDirectoryEntry {
  id: string;
  displayName: string;
  roleCode: "SYSTEM_ADMIN" | "CENTER_MANAGER" | "INSTRUCTOR" | "LEARNER";
  sharedClasses: Array<{ id: string; code: string; name: string }>;
}

export interface ChatMemberView {
  userId: string;
  displayName: string;
  roleCode: string;
  status: "ACTIVE" | "REMOVED";
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  clientMessageId: string;
  content: string;
  replyTo?: { id: string; senderName: string; content: string };
  attachments: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number; canPreview: boolean }>;
  mentionedUserIds: string[];
  context?: { type: "ASSIGNMENT" | "EXAM" | "MATERIAL"; id: string; title: string; href: string };
  createdAt: string;
}

export interface ChatConversationView {
  id: string;
  type: "DIRECT" | "CLASS";
  classId?: string;
  title: string;
  members: ChatMemberView[];
  lastMessage?: ChatMessageView;
  unreadCount: number;
  readOnly: boolean;
  mutedUntil?: string;
  updatedAt: string;
}

export interface ChatMessagePage {
  items: ChatMessageView[];
  nextCursor?: string;
}
