import type { RoleCode } from "./auth.js";
import type { ByteSizeNumber, DecimalNumber, IsoDateTimeString } from "./primitives.js";

export type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type ClassStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type InstructorRole = "PRIMARY" | "CO_INSTRUCTOR";
export type MaterialScope = "CLASS";
export type MaterialVisibility = "DRAFT" | "PUBLISHED" | "HIDDEN";

export interface LearningCourse {
  id: string;
  code: string;
  name: string;
  description: string;
  grade?: number;
  subject?: string;
  outcomes: string[];
  status: PublishStatus;
  version: number;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface CourseVersionSnapshot {
  id: string;
  courseId: string;
  version: number;
  name: string;
  description: string;
  grade?: number;
  subject?: string;
  outcomes: string[];
  publishedBy: string;
  publishedAt: IsoDateTimeString;
}

export interface LearningClass {
  id: string;
  courseId: string;
  courseVersion: number;
  code: string;
  name: string;
  term: string;
  grade?: number;
  subject?: string;
  startAt: IsoDateTimeString;
  endAt: IsoDateTimeString;
  capacity: number;
  timezone: string;
  allowLateEnrollment: boolean;
  allowPeerGradeViewing?: boolean;
  status: ClassStatus;
  instructorIds: string[];
  learnerIds: string[];
  /** Sĩ số lớp; có khi learnerIds đã được rút gọn cho học viên. */
  learnerCount?: number;
  closeReason?: string;
  archivePolicy?: string;
  closedAt?: IsoDateTimeString;
  archivedAt?: IsoDateTimeString;
}

export interface ClassCapabilities {
  classId: string;
  relationship: "ADMIN" | "MANAGER" | "INSTRUCTOR" | "LEARNER" | "NONE";
  classStatus: ClassStatus;
  actions: Record<
    "view" | "manageRoster" | "manageContent" | "submitWork" | "grade" | "postForum" | "joinLive" | "chat",
    { allowed: boolean; reason?: string }
  >;
}

export interface ClassClosureReadiness {
  eligible: boolean;
  blockers: string[];
  openExams: number;
  inProgressAttempts: number;
  pendingGrades: number;
  openAssignments: number;
  pendingAssignmentGrades: number;
  openRegrades: number;
  activeSessions: number;
}

export interface ClassInstructorAssignment {
  instructorId: string;
  role: InstructorRole;
  assignedAt: IsoDateTimeString;
}

export interface ClassRoster {
  classId: string;
  instructors: Array<
    ClassInstructorAssignment & { displayName?: string; email?: string | null }
  >;
  enrollments: Array<{
    learnerId: string;
    displayName?: string;
    email?: string | null;
    status: "ACTIVE" | "CANCELLED";
    source: string;
    joinedAt: IsoDateTimeString;
    removalReason?: string;
    removedAt?: IsoDateTimeString;
  }>;
}

export interface EnrollmentImportResult {
  userId: string;
  status: "ENROLLED" | "SKIPPED" | "FAILED";
  message: string;
}

export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string | null;
  roleCode: "INSTRUCTOR" | "LEARNER";
}

export interface LearningMaterial {
  id: string;
  classId: string;
  courseId?: string;
  ownerId: string;
  name: string;
  mimeType: string;
  sizeBytes: ByteSizeNumber;
  folder: string;
  tags: string[];
  version: number;
  visibility: MaterialVisibility;
  scope: MaterialScope;
  quarantinedAt?: IsoDateTimeString;
  quarantineReason?: string;
  createdAt: IsoDateTimeString;
}

export interface ForumTopic {
  id: string;
  classId: string;
  title: string;
  body: string;
  authorId: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  status: "VISIBLE" | "HIDDEN";
  createdAt: IsoDateTimeString;
}

export interface ForumPost {
  id: string;
  topicId: string;
  authorId: string;
  body: string;
  parentId?: string;
  status: "VISIBLE" | "HIDDEN";
  attachmentIds: string[];
  mentionedUserIds: string[];
  createdAt: IsoDateTimeString;
  editedAt?: IsoDateTimeString;
  deletedAt?: IsoDateTimeString;
  editCount?: number;
}

export interface LearningNotification {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  entityType: string;
  entityId: string;
  readAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
}

export interface RiskThresholds {
  scoreBelow: number;
  completionBelow: number;
}

export interface ProgressIntervention {
  id: string;
  classId: string;
  learnerId: string;
  ownerId: string;
  createdById: string;
  title: string;
  notes?: string;
  dueAt: IsoDateTimeString;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  outcome?: string;
  cancellationReason?: string;
  acceptedAt?: IsoDateTimeString;
  completedAt?: IsoDateTimeString;
  history: Array<{
    fromOwnerId: string;
    toOwnerId: string;
    reason: string;
    actorId: string;
    createdAt: IsoDateTimeString;
  }>;
  createdAt: IsoDateTimeString;
}

export interface LearnerProgress {
  learnerId: string;
  materialCompletionRate: number;
  assessmentCompletionRate: number;
  averageScore: DecimalNumber;
  lastActivityAt?: IsoDateTimeString;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReasons: string[];
  interventions: ProgressIntervention[];
}

export interface ClassProgressReport {
  classId: string;
  classCode: string;
  from: IsoDateTimeString;
  to: IsoDateTimeString;
  thresholds: RiskThresholds;
  learners: LearnerProgress[];
  generatedAt: IsoDateTimeString;
}

export interface OperationalReport {
  courses: number;
  classes: number;
  activeClasses: number;
  learners: number;
  materials: number;
  publishedMaterials: number;
  questions: number;
  exams: number;
  liveSessions: number;
  openReports: number;
  openTickets: number;
  generatedAt: IsoDateTimeString;
  definitionVersion: string;
  timezone: string;
  metricDefinitions: Record<string, string>;
}

export interface LiveSession {
  id: string;
  classId: string;
  hostId?: string;
  title: string;
  startsAt: IsoDateTimeString;
  endsAt: IsoDateTimeString;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED";
  hostUrl: string;
  attendeeUrl: string;
  recordingUrl?: string;
  timezone: string;
  changeReason?: string;
  cancellationReason?: string;
  recordingStatus?: "NONE" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
  recordingReadyAt?: IsoDateTimeString;
  recordingExpiresAt?: IsoDateTimeString;
  recordingError?: string;
  requestedProvider?: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  fallbackUsed?: boolean;
  provisioningAttempts?: number;
}

export interface SupportAttachment {
  id: string;
  ticketId: string;
  name: string;
  mimeType: string;
  sizeBytes: ByteSizeNumber;
  checksum: string;
  createdAt: IsoDateTimeString;
}

export interface SupportTicket {
  id: string;
  clientRequestId?: string;
  reporterId: string;
  category: string;
  severity: "P0" | "P1" | "P2" | "P3";
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  contextId?: string;
  duplicateOfId?: string;
  assigneeId?: string;
  resolution?: string;
  dueAt: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  attachments: SupportAttachment[];
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: IsoDateTimeString;
}

export interface ChatDirectoryEntry {
  id: string;
  displayName: string;
  avatarUrl?: string;
  roleCode: RoleCode;
  sharedClasses: Array<{ id: string; code: string; name: string }>;
}

export interface ChatMemberView {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  roleCode: string;
  status: "ACTIVE" | "REMOVED";
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  clientMessageId: string;
  content: string;
  replyTo?: { id: string; senderName: string; content: string };
  attachments: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: ByteSizeNumber;
    canPreview: boolean;
  }>;
  mentionedUserIds: string[];
  context?: {
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL";
    id: string;
    title: string;
    href: string;
  };
  createdAt: IsoDateTimeString;
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
  mutedUntil?: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ChatMessagePage {
  items: ChatMessageView[];
  nextCursor?: string;
}
