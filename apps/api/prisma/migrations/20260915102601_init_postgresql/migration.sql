-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstructorAssignmentRole" AS ENUM ('PRIMARY', 'CO_INSTRUCTOR');

-- CreateEnum
CREATE TYPE "MaterialVisibility" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RegradeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceAppealStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MFA_LOGIN', 'MFA_DISABLE', 'PASSWORD_CHANGE_OTP', 'MFA_SETUP_OTP', 'MFA_DISABLE_OTP');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentSubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "ChatConversationType" AS ENUM ('DIRECT', 'CLASS');

-- CreateEnum
CREATE TYPE "ChatMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "AiGradingSuggestionState" AS ENUM ('RETRY_AUTHORIZED', 'GENERATING', 'READY', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "AiStudyDraftState" AS ENUM ('RETRY_AUTHORIZED', 'GENERATING', 'READY', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(191) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "password_hash" VARCHAR(255),
    "google_subject" VARCHAR(255),
    "display_name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Bangkok',
    "locale" VARCHAR(20) NOT NULL DEFAULT 'vi-VN',
    "avatar_object_key" VARCHAR(500),
    "avatar_mime_type" VARCHAR(50),
    "avatar_updated_at" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "mfa_secret_encrypted" TEXT,
    "mfa_enabled_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64),
    "user_id" TEXT NOT NULL,
    "current_role_code" VARCHAR(50) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "code_hash" CHAR(64),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "type" "AccountTokenType" NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_versions" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL,
    "published_by" VARCHAR(191) NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_classes" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_version" INTEGER NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "term" VARCHAR(50) NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Bangkok',
    "allow_late_enrollment" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClassStatus" NOT NULL DEFAULT 'DRAFT',
    "close_reason" VARCHAR(500),
    "archive_policy" VARCHAR(50),
    "closed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "max_score" DECIMAL(8,2) NOT NULL,
    "rubric" JSONB NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "closed_at" TIMESTAMP(3),
    "closed_by_id" VARCHAR(191),
    "close_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_changes" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "actor_id" VARCHAR(191) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "reason" TEXT,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "AssignmentSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DECIMAL(8,2),
    "rubric_scores" JSONB,
    "feedback" TEXT,
    "graded_by" VARCHAR(191),
    "graded_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_grading_suggestions" (
    "id" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "context_hash" CHAR(64) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "state" "AiGradingSuggestionState" NOT NULL DEFAULT 'GENERATING',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_grading_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submission_revisions" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submission_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_grade_changes" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "submission_revision" INTEGER NOT NULL,
    "actor_id" VARCHAR(191) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "previous_score" DECIMAL(8,2),
    "next_score" DECIMAL(8,2) NOT NULL,
    "previous_rubric" JSONB,
    "next_rubric" JSONB NOT NULL,
    "previous_feedback" TEXT,
    "next_feedback" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_grade_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submission_attachments" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "removed_at" TIMESTAMP(3),
    "removed_by_id" VARCHAR(191),
    "removal_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submission_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_announcements" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_instructors" (
    "class_id" TEXT NOT NULL,
    "instructor_id" TEXT NOT NULL,
    "role" "InstructorAssignmentRole" NOT NULL DEFAULT 'CO_INSTRUCTOR',
    "assigned_by" VARCHAR(191) NOT NULL DEFAULT 'usr-manager',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_instructors_pkey" PRIMARY KEY ("class_id","instructor_id")
);

-- CreateTable
CREATE TABLE "class_instructor_history" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "instructor_id" TEXT NOT NULL,
    "role" "InstructorAssignmentRole" NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(500),
    "actor_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_instructor_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "removal_reason" VARCHAR(500),
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollment_history" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(500),
    "actor_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_enrollment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128),
    "quarantined_at" TIMESTAMP(3),
    "quarantine_reason" VARCHAR(500),
    "folder" VARCHAR(255) NOT NULL,
    "tags" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "visibility" "MaterialVisibility" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_versions" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128),
    "folder" VARCHAR(255) NOT NULL,
    "tags" JSONB NOT NULL,
    "visibility" "MaterialVisibility" NOT NULL,
    "created_by" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_study_drafts" (
    "id" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL,
    "state" "AiStudyDraftState" NOT NULL DEFAULT 'GENERATING',
    "options" JSONB NOT NULL,
    "result" JSONB,
    "edited_result" JSONB,
    "edit_revision" INTEGER NOT NULL DEFAULT 0,
    "published_result" JSONB,
    "published_at" TIMESTAMP(3),
    "publication_revision" INTEGER NOT NULL DEFAULT 0,
    "published_edit_revision" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_study_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_reviews" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_access_logs" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "content" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_answers" JSONB NOT NULL,
    "difficulty" SMALLINT NOT NULL DEFAULT 1,
    "tags" JSONB NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "family_id" VARCHAR(191) NOT NULL,
    "supersedes_id" VARCHAR(191),
    "content_hash" VARCHAR(64) NOT NULL,
    "image_object_key" VARCHAR(500),
    "image_name" VARCHAR(255),
    "image_mime_type" VARCHAR(100),
    "image_size_bytes" BIGINT,
    "image_checksum" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "total_score" DECIMAL(8,2) NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "close_at" TIMESTAMP(3) NOT NULL,
    "attempt_limit" INTEGER NOT NULL DEFAULT 1,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "random_seed" VARCHAR(100),
    "ai_context" JSONB,
    "generation_request_id" VARCHAR(100),
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_approvals" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "exam_version" INTEGER NOT NULL,
    "decision" VARCHAR(30) NOT NULL,
    "review_note" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "exam_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("exam_id","question_id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" DECIMAL(8,2),
    "feedback" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "grade_published_at" TIMESTAMP(3),

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_history" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "grader_id" VARCHAR(191) NOT NULL,
    "previous_score" DECIMAL(8,2),
    "next_score" DECIMAL(8,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regrade_requests" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RegradeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "assigned_to_id" VARCHAR(191),
    "resolved_by_id" VARCHAR(191),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regrade_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_answers" (
    "attempt_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer_data" JSONB NOT NULL,
    "score" DECIMAL(8,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("attempt_id","question_id")
);

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "edit_history" JSONB,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_post_attachments" (
    "post_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,

    CONSTRAINT "forum_post_attachments_pkey" PRIMARY KEY ("post_id","material_id")
);

-- CreateTable
CREATE TABLE "forum_mentions" (
    "post_id" TEXT NOT NULL,
    "mentioned_user_id" TEXT NOT NULL,

    CONSTRAINT "forum_mentions_pkey" PRIMARY KEY ("post_id","mentioned_user_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(191) NOT NULL,
    "dedup_key" VARCHAR(255) NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reports" (
    "id" TEXT NOT NULL,
    "target_type" VARCHAR(30) NOT NULL,
    "target_id" VARCHAR(191) NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" VARCHAR(150) NOT NULL,
    "details" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "assigned_to_id" VARCHAR(191),
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMP(3),
    "appeal_reason" TEXT,
    "appealed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "actor_id" VARCHAR(191) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_status" "ReportStatus" NOT NULL,
    "next_status" "ReportStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "requested_provider" VARCHAR(50) NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "provisioning_attempts" INTEGER NOT NULL DEFAULT 1,
    "provider_ref" VARCHAR(255),
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Bangkok',
    "host_url" VARCHAR(1000) NOT NULL,
    "attendee_url" VARCHAR(1000) NOT NULL,
    "recording_url" VARCHAR(1000),
    "recording_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
    "recording_ready_at" TIMESTAMP(3),
    "recording_expires_at" TIMESTAMP(3),
    "recording_error" VARCHAR(500),
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "change_reason" VARCHAR(500),
    "cancellation_reason" VARCHAR(500),
    "attendance_locked_at" TIMESTAMP(3),
    "attendance_locked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "session_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "attended_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "adjustment_reason" VARCHAR(500),
    "provider_participant_id" VARCHAR(191),
    "provider_snapshot" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("session_id","learner_id")
);

-- CreateTable
CREATE TABLE "attendance_intervals" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL,
    "left_at" TIMESTAMP(3),
    "source" VARCHAR(30) NOT NULL,
    "provider_participant_id" VARCHAR(191),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_appeals" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AttendanceAppealStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "client_request_id" VARCHAR(36),
    "duplicate_of_id" TEXT,
    "reporter_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "category" VARCHAR(100) NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "context_id" VARCHAR(191),
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(191) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_setting_revisions" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "updated_by" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_setting_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "approved_by" VARCHAR(191) NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(191) NOT NULL,
    "released_at" TIMESTAMP(3),
    "released_by" VARCHAR(191),
    "release_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_jobs" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "affected_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "requested_by" VARCHAR(191) NOT NULL,
    "approved_by" VARCHAR(191) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(191) NOT NULL,
    "service_name" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(500) NOT NULL,
    "metric_value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by" VARCHAR(191),
    "muted_until" TIMESTAMP(3),
    "recovered_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_providers" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credential_ref" VARCHAR(255),
    "webhook_url" VARCHAR(1000),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "health_status" VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
    "last_checked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "checksum" VARCHAR(128),
    "size_bytes" BIGINT,
    "object_key" VARCHAR(500),
    "error_message" VARCHAR(500),
    "requested_by" VARCHAR(191) NOT NULL DEFAULT 'system',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_jobs" (
    "id" TEXT NOT NULL,
    "backup_id" TEXT NOT NULL,
    "mode" VARCHAR(30) NOT NULL DEFAULT 'DRILL',
    "requested_by" VARCHAR(191) NOT NULL DEFAULT 'system',
    "approved_by" VARCHAR(191),
    "reason" VARCHAR(500),
    "target_database" VARCHAR(191),
    "approved_at" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "verification" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_jobs" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "row_count" INTEGER,
    "object_key" VARCHAR(500),
    "checksum" VARCHAR(128),
    "size_bytes" BIGINT,
    "error_message" VARCHAR(500),
    "requested_by" VARCHAR(191) NOT NULL DEFAULT 'system',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "event_code" VARCHAR(100) NOT NULL,
    "locale" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_policies" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prohibited_terms" JSONB NOT NULL,
    "max_posts_per_minute" INTEGER NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "published_by" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" TEXT,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(191),
    "request_id" VARCHAR(100),
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_interventions" (
    "id" TEXT NOT NULL,
    "class_id" VARCHAR(191) NOT NULL,
    "learner_id" VARCHAR(191) NOT NULL,
    "owner_id" VARCHAR(191) NOT NULL,
    "created_by_id" VARCHAR(191) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "InterventionStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "cancellation_reason" VARCHAR(1000),
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "handoff_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" VARCHAR(191) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(191) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_deliveries" (
    "id" VARCHAR(191) NOT NULL,
    "event_id" VARCHAR(191) NOT NULL,
    "recipient_id" VARCHAR(191) NOT NULL,
    "channel" VARCHAR(30) NOT NULL,
    "dedup_key" VARCHAR(255) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_message_id" VARCHAR(191),
    "last_error" VARCHAR(500),
    "delivered_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "type" "ChatConversationType" NOT NULL,
    "class_id" TEXT,
    "direct_key" VARCHAR(383),
    "created_by_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversation_members" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_snapshot" VARCHAR(50) NOT NULL,
    "status" "ChatMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "last_read_at" TIMESTAMP(3),
    "muted_until" TIMESTAMP(3),

    CONSTRAINT "chat_conversation_members_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "client_message_id" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "reply_to_id" TEXT,
    "context_type" VARCHAR(30),
    "context_id" VARCHAR(191),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_mentions" (
    "message_id" TEXT NOT NULL,
    "mentioned_user_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_mentions_pkey" PRIMARY KEY ("message_id","mentioned_user_id")
);

-- CreateTable
CREATE TABLE "chat_message_reports" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reporter_id" VARCHAR(191) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_id" VARCHAR(191) NOT NULL,
    "blocked_id" VARCHAR(191) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "report_type" VARCHAR(50) NOT NULL,
    "definition_version" VARCHAR(30) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "requested_by_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" TEXT NOT NULL,
    "report_run_id" TEXT NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(1000),
    "size_bytes" BIGINT,
    "error_message" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "requested_by_id" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_object_key_key" ON "users"("avatar_object_key");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_revoked_at_idx" ON "auth_sessions"("expires_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_tokens_user_id_type_expires_at_idx" ON "account_tokens"("user_id", "type", "expires_at");

-- CreateIndex
CREATE INDEX "account_tokens_expires_at_consumed_at_idx" ON "account_tokens"("expires_at", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx" ON "mfa_recovery_codes"("user_id", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_owner_id_status_idx" ON "courses"("owner_id", "status");

-- CreateIndex
CREATE INDEX "course_versions_course_id_published_at_idx" ON "course_versions"("course_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_course_id_version_key" ON "course_versions"("course_id", "version");

-- CreateIndex
CREATE INDEX "learning_classes_course_id_status_idx" ON "learning_classes"("course_id", "status");

-- CreateIndex
CREATE INDEX "learning_classes_term_idx" ON "learning_classes"("term");

-- CreateIndex
CREATE UNIQUE INDEX "learning_classes_code_term_key" ON "learning_classes"("code", "term");

-- CreateIndex
CREATE INDEX "assignments_class_id_status_due_at_idx" ON "assignments"("class_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "assignments_created_by_id_idx" ON "assignments"("created_by_id");

-- CreateIndex
CREATE INDEX "assignment_changes_assignment_id_created_at_idx" ON "assignment_changes"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "assignment_submissions_learner_id_status_idx" ON "assignment_submissions"("learner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_learner_id_key" ON "assignment_submissions"("assignment_id", "learner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_grading_suggestions_fingerprint_key" ON "ai_grading_suggestions"("fingerprint");

-- CreateIndex
CREATE INDEX "ai_grading_suggestions_owner_id_submission_id_created_at_idx" ON "ai_grading_suggestions"("owner_id", "submission_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_grading_operations_state_created_id" ON "ai_grading_suggestions"("state", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_revisions_submission_id_revision_key" ON "assignment_submission_revisions"("submission_id", "revision");

-- CreateIndex
CREATE INDEX "assignment_grade_changes_submission_id_created_at_idx" ON "assignment_grade_changes"("submission_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_attachments_object_key_key" ON "assignment_submission_attachments"("object_key");

-- CreateIndex
CREATE INDEX "assignment_submission_attachments_submission_id_created_at_idx" ON "assignment_submission_attachments"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "class_announcements_class_id_published_at_idx" ON "class_announcements"("class_id", "published_at");

-- CreateIndex
CREATE INDEX "class_announcements_author_id_idx" ON "class_announcements"("author_id");

-- CreateIndex
CREATE INDEX "class_instructors_instructor_id_idx" ON "class_instructors"("instructor_id");

-- CreateIndex
CREATE INDEX "class_instructor_history_class_id_created_at_idx" ON "class_instructor_history"("class_id", "created_at");

-- CreateIndex
CREATE INDEX "class_enrollments_learner_id_status_idx" ON "class_enrollments"("learner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_class_id_learner_id_key" ON "class_enrollments"("class_id", "learner_id");

-- CreateIndex
CREATE INDEX "class_enrollment_history_class_id_created_at_idx" ON "class_enrollment_history"("class_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "materials_object_key_key" ON "materials"("object_key");

-- CreateIndex
CREATE INDEX "materials_class_id_visibility_idx" ON "materials"("class_id", "visibility");

-- CreateIndex
CREATE INDEX "materials_course_id_visibility_idx" ON "materials"("course_id", "visibility");

-- CreateIndex
CREATE INDEX "materials_owner_id_idx" ON "materials"("owner_id");

-- CreateIndex
CREATE INDEX "materials_quarantined_at_idx" ON "materials"("quarantined_at");

-- CreateIndex
CREATE INDEX "material_versions_created_at_idx" ON "material_versions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_material_id_version_key" ON "material_versions"("material_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_study_drafts_fingerprint_key" ON "ai_study_drafts"("fingerprint");

-- CreateIndex
CREATE INDEX "ai_study_drafts_owner_id_material_id_created_at_id_idx" ON "ai_study_drafts"("owner_id", "material_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ai_study_operations_state_created_id" ON "ai_study_drafts"("state", "created_at", "id");

-- CreateIndex
CREATE INDEX "file_reviews_material_id_created_at_idx" ON "file_reviews"("material_id", "created_at");

-- CreateIndex
CREATE INDEX "file_reviews_reviewer_id_idx" ON "file_reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "material_access_logs_material_id_created_at_idx" ON "material_access_logs"("material_id", "created_at");

-- CreateIndex
CREATE INDEX "material_access_logs_user_id_created_at_idx" ON "material_access_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "questions_course_id_status_idx" ON "questions"("course_id", "status");

-- CreateIndex
CREATE INDEX "questions_family_id_version_idx" ON "questions"("family_id", "version");

-- CreateIndex
CREATE INDEX "questions_course_id_content_hash_idx" ON "questions"("course_id", "content_hash");

-- CreateIndex
CREATE INDEX "questions_author_id_idx" ON "questions"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "exams_generation_request_id_key" ON "exams"("generation_request_id");

-- CreateIndex
CREATE INDEX "exams_class_id_status_open_at_idx" ON "exams"("class_id", "status", "open_at");

-- CreateIndex
CREATE INDEX "exam_approvals_exam_id_created_at_idx" ON "exam_approvals"("exam_id", "created_at");

-- CreateIndex
CREATE INDEX "exam_approvals_reviewer_id_idx" ON "exam_approvals"("reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_exam_id_position_key" ON "exam_questions"("exam_id", "position");

-- CreateIndex
CREATE INDEX "exam_attempts_learner_id_status_idx" ON "exam_attempts"("learner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_exam_id_learner_id_attempt_no_key" ON "exam_attempts"("exam_id", "learner_id", "attempt_no");

-- CreateIndex
CREATE INDEX "grade_history_attempt_id_created_at_idx" ON "grade_history"("attempt_id", "created_at");

-- CreateIndex
CREATE INDEX "regrade_requests_attempt_id_status_idx" ON "regrade_requests"("attempt_id", "status");

-- CreateIndex
CREATE INDEX "regrade_requests_assigned_to_id_status_idx" ON "regrade_requests"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "regrade_requests_learner_id_created_at_idx" ON "regrade_requests"("learner_id", "created_at");

-- CreateIndex
CREATE INDEX "forum_topics_class_id_created_at_idx" ON "forum_topics"("class_id", "created_at");

-- CreateIndex
CREATE INDEX "forum_posts_topic_id_status_created_at_idx" ON "forum_posts"("topic_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "forum_posts_parent_id_idx" ON "forum_posts"("parent_id");

-- CreateIndex
CREATE INDEX "forum_post_attachments_material_id_idx" ON "forum_post_attachments"("material_id");

-- CreateIndex
CREATE INDEX "forum_mentions_mentioned_user_id_idx" ON "forum_mentions"("mentioned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedup_key_key" ON "notifications"("dedup_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "content_reports_status_created_at_idx" ON "content_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_reports_target_type_target_id_reporter_id_status_key" ON "content_reports"("target_type", "target_id", "reporter_id", "status");

-- CreateIndex
CREATE INDEX "moderation_actions_report_id_created_at_idx" ON "moderation_actions"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_actor_id_created_at_idx" ON "moderation_actions"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "live_sessions_class_id_starts_at_idx" ON "live_sessions"("class_id", "starts_at");

-- CreateIndex
CREATE INDEX "live_sessions_host_id_idx" ON "live_sessions"("host_id");

-- CreateIndex
CREATE INDEX "attendance_records_learner_id_status_idx" ON "attendance_records"("learner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_provider_participant_id_key" ON "attendance_records"("session_id", "provider_participant_id");

-- CreateIndex
CREATE INDEX "attendance_intervals_session_id_learner_id_joined_at_idx" ON "attendance_intervals"("session_id", "learner_id", "joined_at");

-- CreateIndex
CREATE INDEX "attendance_intervals_provider_participant_id_idx" ON "attendance_intervals"("provider_participant_id");

-- CreateIndex
CREATE INDEX "attendance_appeals_session_id_status_idx" ON "attendance_appeals"("session_id", "status");

-- CreateIndex
CREATE INDEX "attendance_appeals_learner_id_created_at_idx" ON "attendance_appeals"("learner_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_severity_due_at_idx" ON "support_tickets"("status", "severity", "due_at");

-- CreateIndex
CREATE INDEX "support_tickets_reporter_id_idx" ON "support_tickets"("reporter_id");

-- CreateIndex
CREATE INDEX "support_tickets_duplicate_of_id_idx" ON "support_tickets"("duplicate_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_reporter_id_client_request_id_key" ON "support_tickets"("reporter_id", "client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_object_key_key" ON "support_attachments"("object_key");

-- CreateIndex
CREATE INDEX "support_attachments_ticket_id_created_at_idx" ON "support_attachments"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "support_attachments_uploader_id_idx" ON "support_attachments"("uploader_id");

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_created_at_idx" ON "ticket_comments"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_comments_author_id_idx" ON "ticket_comments"("author_id");

-- CreateIndex
CREATE INDEX "system_setting_revisions_key_effective_at_idx" ON "system_setting_revisions"("key", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_setting_revisions_key_version_key" ON "system_setting_revisions"("key", "version");

-- CreateIndex
CREATE INDEX "retention_policies_category_effective_at_idx" ON "retention_policies"("category", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_category_version_key" ON "retention_policies"("category", "version");

-- CreateIndex
CREATE INDEX "legal_holds_category_active_idx" ON "legal_holds"("category", "active");

-- CreateIndex
CREATE INDEX "retention_jobs_status_created_at_idx" ON "retention_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "retention_jobs_status_available_at_idx" ON "retention_jobs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_alerts_fingerprint_key" ON "system_alerts"("fingerprint");

-- CreateIndex
CREATE INDEX "system_alerts_status_severity_detected_at_idx" ON "system_alerts"("status", "severity", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_provider_key" ON "integration_providers"("provider");

-- CreateIndex
CREATE INDEX "integration_providers_is_default_enabled_idx" ON "integration_providers"("is_default", "enabled");

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_jobs_status_available_at_idx" ON "backup_jobs"("status", "available_at");

-- CreateIndex
CREATE INDEX "restore_jobs_status_created_at_idx" ON "restore_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "data_export_jobs_status_expires_at_idx" ON "data_export_jobs"("status", "expires_at");

-- CreateIndex
CREATE INDEX "data_export_jobs_status_available_at_idx" ON "data_export_jobs"("status", "available_at");

-- CreateIndex
CREATE INDEX "notification_templates_event_code_locale_status_idx" ON "notification_templates"("event_code", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_code_locale_version_key" ON "notification_templates"("event_code", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_policies_version_key" ON "moderation_policies"("version");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "progress_interventions_class_id_learner_id_status_idx" ON "progress_interventions"("class_id", "learner_id", "status");

-- CreateIndex
CREATE INDEX "progress_interventions_owner_id_due_at_idx" ON "progress_interventions"("owner_id", "due_at");

-- CreateIndex
CREATE INDEX "outbox_events_type_created_at_idx" ON "outbox_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_deliveries_dedup_key_key" ON "outbox_deliveries"("dedup_key");

-- CreateIndex
CREATE INDEX "outbox_deliveries_status_available_at_idx" ON "outbox_deliveries"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_deliveries_recipient_id_updated_at_idx" ON "outbox_deliveries"("recipient_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_class_id_key" ON "chat_conversations"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_direct_key_key" ON "chat_conversations"("direct_key");

-- CreateIndex
CREATE INDEX "chat_conversations_type_updated_at_idx" ON "chat_conversations"("type", "updated_at");

-- CreateIndex
CREATE INDEX "chat_conversation_members_user_id_status_idx" ON "chat_conversation_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_sender_id_client_message_id_key" ON "chat_messages"("sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_attachments_object_key_key" ON "chat_message_attachments"("object_key");

-- CreateIndex
CREATE INDEX "chat_message_attachments_message_id_created_at_idx" ON "chat_message_attachments"("message_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_message_mentions_mentioned_user_id_created_at_idx" ON "chat_message_mentions"("mentioned_user_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_message_reports_status_created_at_idx" ON "chat_message_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_reports_message_id_reporter_id_key" ON "chat_message_reports"("message_id", "reporter_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_created_at_idx" ON "user_blocks"("blocked_id", "created_at");

-- CreateIndex
CREATE INDEX "report_runs_report_type_created_at_idx" ON "report_runs"("report_type", "created_at");

-- CreateIndex
CREATE INDEX "report_runs_requested_by_id_created_at_idx" ON "report_runs"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "report_exports_requested_by_id_created_at_idx" ON "report_exports"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "report_exports_status_expires_at_idx" ON "report_exports"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_classes" ADD CONSTRAINT "learning_classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_changes" ADD CONSTRAINT "assignment_changes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_grading_suggestions" ADD CONSTRAINT "ai_grading_suggestions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_grading_suggestions" ADD CONSTRAINT "ai_grading_suggestions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_revisions" ADD CONSTRAINT "assignment_submission_revisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_grade_changes" ADD CONSTRAINT "assignment_grade_changes_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_attachments" ADD CONSTRAINT "assignment_submission_attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_announcements" ADD CONSTRAINT "class_announcements_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_announcements" ADD CONSTRAINT "class_announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_instructors" ADD CONSTRAINT "class_instructors_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_instructors" ADD CONSTRAINT "class_instructors_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_instructor_history" ADD CONSTRAINT "class_instructor_history_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollment_history" ADD CONSTRAINT "class_enrollment_history_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_study_drafts" ADD CONSTRAINT "ai_study_drafts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_study_drafts" ADD CONSTRAINT "ai_study_drafts_material_id_source_version_fkey" FOREIGN KEY ("material_id", "source_version") REFERENCES "material_versions"("material_id", "version") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_reviews" ADD CONSTRAINT "file_reviews_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_reviews" ADD CONSTRAINT "file_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_access_logs" ADD CONSTRAINT "material_access_logs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_access_logs" ADD CONSTRAINT "material_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_approvals" ADD CONSTRAINT "exam_approvals_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_approvals" ADD CONSTRAINT "exam_approvals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_history" ADD CONSTRAINT "grade_history_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regrade_requests" ADD CONSTRAINT "regrade_requests_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regrade_requests" ADD CONSTRAINT "regrade_requests_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_attachments" ADD CONSTRAINT "forum_post_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_attachments" ADD CONSTRAINT "forum_post_attachments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_mentions" ADD CONSTRAINT "forum_mentions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_mentions" ADD CONSTRAINT "forum_mentions_mentioned_user_id_fkey" FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "content_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_attendance_locked_by_id_fkey" FOREIGN KEY ("attendance_locked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_intervals" ADD CONSTRAINT "attendance_intervals_session_id_learner_id_fkey" FOREIGN KEY ("session_id", "learner_id") REFERENCES "attendance_records"("session_id", "learner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_appeals" ADD CONSTRAINT "attendance_appeals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_appeals" ADD CONSTRAINT "attendance_appeals_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_jobs" ADD CONSTRAINT "retention_jobs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_jobs" ADD CONSTRAINT "restore_jobs_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backup_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reports" ADD CONSTRAINT "chat_message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_run_id_fkey" FOREIGN KEY ("report_run_id") REFERENCES "report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
