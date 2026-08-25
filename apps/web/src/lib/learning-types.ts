export type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Course {
  id: string; code: string; name: string; description: string; outcomes: string[];
  status: PublishStatus; version: number; createdAt: string; updatedAt: string;
}

export interface LearningClass {
  id: string; courseId: string; code: string; name: string; term: string;
  startAt: string; endAt: string; capacity: number; status: "DRAFT" | "ACTIVE" | "CLOSED";
  instructorIds: string[]; learnerIds: string[];
}

export interface Material {
  id: string; classId: string; name: string; mimeType: string; sizeBytes: number;
  folder: string; tags: string[]; version: number; visibility: "DRAFT" | "PUBLISHED" | "HIDDEN"; quarantinedAt?: string; quarantineReason?: string; createdAt: string;
}

export interface Question {
  id: string; courseId: string; type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string; options: string[]; correctAnswers: string[]; difficulty: 1 | 2 | 3;
  tags: string[]; status: "DRAFT" | "PUBLISHED"; version: number;
}

export interface Exam {
  id: string; classId: string; title: string; questionIds: string[]; durationMinutes: number;
  totalScore: number; openAt: string; closeAt: string; attemptLimit: number;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED"; version: number;
}

export interface ExamAttempt {
  id: string; examId: string; learnerId: string; answers: Record<string, string[]>;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED"; startedAt: string; submittedAt?: string; score?: number; feedback?: string; gradePublishedAt?: string;
}

export interface RegradeRequest { id: string; attemptId: string; learnerId: string; reason: string; status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution?: string; createdAt: string }
export interface LearnerResult { attempt: ExamAttempt; exam: { id: string; title: string; totalScore: number; closeAt: string }; answerBreakdown: Array<{ questionId: string; content: string; submittedAnswers: string[]; awardedScore: number; maxScore: number }>; regradeRequest?: RegradeRequest }

export interface ForumTopic { id: string; classId: string; title: string; body: string; authorId: string; tags: string[]; isPinned: boolean; isLocked: boolean; createdAt: string }
export interface ForumPost { id: string; topicId: string; authorId: string; body: string; parentId?: string; status: "VISIBLE" | "HIDDEN"; attachmentIds: string[]; mentionedUserIds: string[]; createdAt: string }
export interface LearningNotification { id: string; recipientId: string; type: string; title: string; entityType: string; entityId: string; readAt?: string; createdAt: string }
export interface ContentReport { id: string; targetType: "TOPIC" | "POST"; targetId: string; reporterId: string; reason: string; details: string; status: "OPEN" | "RESOLVED" | "REJECTED"; resolution?: string }
export interface LiveSession { id: string; classId: string; title: string; startsAt: string; endsAt: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"; hostUrl: string; attendeeUrl: string; recordingUrl?: string; attendanceLockedAt?: string; attendanceLockedById?: string }
export interface AttendanceRecord { sessionId: string; learnerId: string; joinedAt?: string; leftAt?: string; attendedMinutes: number; status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED"; adjustmentReason?: string; providerParticipantId?: string }
export interface AttendanceAppeal { id: string; sessionId: string; learnerId: string; reason: string; status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution?: string; createdAt: string }
export interface AttendanceSessionReview { session: LiveSession; enrolledLearnerIds: string[]; records: AttendanceRecord[]; appeals: AttendanceAppeal[] }
export interface SupportAttachment { id: string; ticketId: string; name: string; mimeType: string; sizeBytes: number; checksum: string; createdAt: string }
export interface Ticket { id: string; reporterId: string; category: string; severity: "P0" | "P1" | "P2" | "P3"; description: string; contextId?: string; duplicateOfId?: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"; assigneeId?: string; resolution?: string; dueAt: string; createdAt: string; attachments: SupportAttachment[] }
export interface TicketComment { id: string; ticketId: string; authorId: string; body: string; createdAt: string }
