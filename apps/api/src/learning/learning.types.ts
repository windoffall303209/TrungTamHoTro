export type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface LearningCourse {
  id: string; code: string; name: string; description: string; outcomes: string[];
  status: PublishStatus; version: number; createdAt: string; updatedAt: string;
}
export interface CourseVersionSnapshot { id: string; courseId: string; version: number; name: string; description: string; outcomes: string[]; publishedBy: string; publishedAt: string }

export interface LearningClass {
  id: string; courseId: string; courseVersion: number; code: string; name: string; term: string;
  startAt: string; endAt: string; capacity: number; timezone: string; allowLateEnrollment: boolean; status: "DRAFT" | "ACTIVE" | "CLOSED";
  instructorIds: string[]; learnerIds: string[]; closeReason?: string; archivePolicy?: string; closedAt?: string; archivedAt?: string;
}
export interface ClassClosureReadiness { eligible: boolean; blockers: string[]; openExams: number; pendingGrades: number; activeSessions: number; unlockedAttendanceSessions: number; openAppeals: number }
export type InstructorRole = "PRIMARY" | "CO_INSTRUCTOR";
export interface ClassInstructorAssignment { instructorId: string; role: InstructorRole; assignedAt: string }
export interface ClassMemberHistory { id: string; memberId: string; memberType: "INSTRUCTOR" | "LEARNER"; action: string; role?: InstructorRole; source?: string; reason?: string; actorId: string; createdAt: string }
export interface ClassRoster { classId: string; instructors: ClassInstructorAssignment[]; enrollments: Array<{ learnerId: string; status: "ACTIVE" | "CANCELLED"; source: string; joinedAt: string; removalReason?: string; removedAt?: string }>; history: ClassMemberHistory[] }
export interface EnrollmentImportResult { userId: string; status: "ENROLLED" | "SKIPPED" | "FAILED"; message: string }

export interface LearningMaterial {
  id: string; classId: string; name: string; mimeType: string; sizeBytes: number;
  folder: string; tags: string[]; version: number; visibility: "DRAFT" | "PUBLISHED" | "HIDDEN";
  quarantinedAt?: string; quarantineReason?: string; createdAt: string;
}
export interface FileReviewRecord { id: string; materialId: string; reviewerId: string; action: "APPROVE" | "HIDE" | "REQUEST_CHANGES"; reason?: string; createdAt: string }

export interface LearningQuestion {
  id: string; courseId: string; type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string; options: string[]; correctAnswers: string[]; difficulty: 1 | 2 | 3; tags: string[];
  status: "DRAFT" | "PUBLISHED"; version: number; familyId?: string; supersedesId?: string;
}
export interface MaterialVersionSnapshot { id: string; materialId: string; version: number; name: string; mimeType: string; sizeBytes: number; folder: string; tags: string[]; visibility: "DRAFT" | "PUBLISHED" | "HIDDEN"; createdBy: string; createdAt: string }
export interface QuestionImportResult { row: number; status: "IMPORTED" | "FAILED"; questionId?: string; message: string }

export interface LearningExam {
  id: string; classId: string; title: string; questionIds: string[]; durationMinutes: number;
  totalScore: number; openAt: string; closeAt: string; attemptLimit: number;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED"; version: number;
}
export interface ExamApprovalRecord { id: string; examId: string; reviewerId: string; examVersion: number; decision: "APPROVE" | "RETURN"; reviewNote?: string; createdAt: string }

export interface LearnerExamSummary extends LearningExam {
  questionCount: number;
  availabilityStatus: "UPCOMING" | "AVAILABLE" | "IN_PROGRESS" | "ATTEMPT_LIMIT_REACHED" | "CLOSED";
  remainingAttempts: number;
  serverTime: string;
}

export interface ExamAttempt {
  id: string; examId: string; learnerId: string; answers: Record<string, string[]>;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED"; startedAt: string; submittedAt?: string;
  score?: number; feedback?: string;
  gradePublishedAt?: string;
}

export interface RegradeRequest {
  id: string; attemptId: string; learnerId: string; reason: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution?: string; createdAt: string;
}

export interface LearnerResult {
  attempt: ExamAttempt;
  exam: { id: string; title: string; totalScore: number; closeAt: string };
  answerBreakdown: Array<{ questionId: string; content: string; submittedAnswers: string[]; awardedScore: number; maxScore: number }>;
  regradeRequest?: RegradeRequest;
}

export interface ForumTopic {
  id: string; classId: string; title: string; body: string; authorId: string;
  tags: string[]; isPinned: boolean; isLocked: boolean; status: "VISIBLE" | "HIDDEN"; createdAt: string;
}

export interface ForumPost {
  id: string; topicId: string; authorId: string; body: string; parentId?: string;
  status: "VISIBLE" | "HIDDEN"; attachmentIds: string[]; mentionedUserIds: string[]; createdAt: string;
  editedAt?: string; deletedAt?: string; editCount?: number;
}

export interface LearningNotification {
  id: string; recipientId: string; type: string; title: string; entityType: string;
  entityId: string; readAt?: string; createdAt: string;
}

export interface ContentReport {
  id: string; targetType: "TOPIC" | "POST"; targetId: string; reporterId: string;
  reason: string; details: string; status: "OPEN" | "IN_REVIEW" | "ESCALATED" | "RESOLVED" | "REJECTED"; resolution?: string;
  assignedToId?: string; escalationLevel: number; resolvedAt?: string; appealReason?: string; appealedAt?: string;
  createdAt: string; updatedAt: string; actions: ModerationActionRecord[];
}

export interface ModerationActionRecord {
  id: string; reportId: string; actorId: string; action: "CLAIM" | "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN" | "APPEAL";
  reason: string; previousStatus: ContentReport["status"]; nextStatus: ContentReport["status"]; createdAt: string;
}

export interface ModerationContext {
  report: ContentReport; classId: string; topicTitle: string; targetAuthorId: string; targetBody: string;
  surroundingPosts: Array<Pick<ForumPost, "id" | "authorId" | "body" | "createdAt">>;
}

export interface RiskThresholds { attendanceBelow: number; scoreBelow: number; completionBelow: number }
export interface ProgressIntervention { id: string; classId: string; learnerId: string; ownerId: string; title: string; notes?: string; dueAt: string; status: "OPEN" | "DONE" | "CANCELLED"; completedAt?: string; createdAt: string }
export interface LearnerProgress { learnerId: string; materialCompletionRate: number; assessmentCompletionRate: number; attendanceRate: number; averageScore: number; lastActivityAt?: string; riskLevel: "LOW" | "MEDIUM" | "HIGH"; riskReasons: string[]; interventions: ProgressIntervention[] }
export interface ClassProgressReport { classId: string; classCode: string; from: string; to: string; thresholds: RiskThresholds; learners: LearnerProgress[]; generatedAt: string }
export interface OperationalReport { courses: number; classes: number; activeClasses: number; learners: number; materials: number; publishedMaterials: number; questions: number; exams: number; liveSessions: number; openReports: number; openTickets: number; generatedAt: string; definitionVersion: string; timezone: string; metricDefinitions: Record<string, string> }
export interface ReportRun { id: string; reportType: "OPERATIONS"; definitionVersion: string; timezone: string; filters: { from: string; to: string }; result: OperationalReport; requestedById: string; createdAt: string }
export interface ReportExport { id: string; reportRunId: string; format: "CSV"; status: "QUEUED" | "COMPLETED" | "FAILED" | "EXPIRED"; fileName: string; sizeBytes?: number; errorMessage?: string; expiresAt: string; createdAt: string }

export interface LiveSession {
  id: string; classId: string; title: string; startsAt: string; endsAt: string;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED";
  hostUrl: string; attendeeUrl: string; recordingUrl?: string; timezone: string; changeReason?: string; cancellationReason?: string; attendanceLockedAt?: string; attendanceLockedById?: string;
}

export interface AttendanceRecord {
  sessionId: string; learnerId: string; joinedAt?: string; leftAt?: string;
  attendedMinutes: number; status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED"; adjustmentReason?: string;
  providerParticipantId?: string; providerSnapshot?: Record<string, unknown>;
}
export interface AttendanceAppeal { id: string; sessionId: string; learnerId: string; reason: string; status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution?: string; createdAt: string }
export interface ProviderAttendanceInput { providerParticipantId: string; learnerId: string; joinedAt: string; leftAt: string }
export interface AttendanceSessionReview { session: LiveSession; enrolledLearnerIds: string[]; records: AttendanceRecord[]; appeals: AttendanceAppeal[] }

export interface SupportTicket {
  id: string; reporterId: string; category: string; severity: "P0" | "P1" | "P2" | "P3";
  description: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  contextId?: string; duplicateOfId?: string; assigneeId?: string; resolution?: string; dueAt: string; createdAt: string;
  attachments: SupportAttachment[];
}
export interface SupportAttachment { id: string; ticketId: string; name: string; mimeType: string; sizeBytes: number; checksum: string; createdAt: string }
export interface TicketComment { id: string; ticketId: string; authorId: string; body: string; createdAt: string }
