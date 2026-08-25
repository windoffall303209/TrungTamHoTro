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
  folder: string; tags: string[]; version: number; visibility: "DRAFT" | "PUBLISHED" | "HIDDEN"; createdAt: string;
}

export interface Question {
  id: string; courseId: string; type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string; options: string[]; correctAnswers: string[]; difficulty: 1 | 2 | 3;
  tags: string[]; status: "DRAFT" | "PUBLISHED"; version: number;
}

export interface Exam {
  id: string; classId: string; title: string; questionIds: string[]; durationMinutes: number;
  totalScore: number; openAt: string; closeAt: string; attemptLimit: number;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED";
}

export interface ExamAttempt {
  id: string; examId: string; learnerId: string; answers: Record<string, string[]>;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED"; startedAt: string; submittedAt?: string; score?: number; feedback?: string;
}

export interface ForumTopic { id: string; classId: string; title: string; body: string; authorId: string; tags: string[]; isPinned: boolean; isLocked: boolean; createdAt: string }
export interface ForumPost { id: string; topicId: string; authorId: string; body: string; parentId?: string; status: "VISIBLE" | "HIDDEN"; createdAt: string }
export interface ContentReport { id: string; targetType: "TOPIC" | "POST"; targetId: string; reporterId: string; reason: string; details: string; status: "OPEN" | "RESOLVED" | "REJECTED"; resolution?: string }
export interface LiveSession { id: string; classId: string; title: string; startsAt: string; endsAt: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"; hostUrl: string; attendeeUrl: string; recordingUrl?: string }
export interface Ticket { id: string; reporterId: string; category: string; severity: "P0" | "P1" | "P2" | "P3"; description: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"; assigneeId?: string; resolution?: string; createdAt: string }

