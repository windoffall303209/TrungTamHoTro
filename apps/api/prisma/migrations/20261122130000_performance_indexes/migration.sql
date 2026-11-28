-- PERF-02: index cho cột khóa ngoại (tránh quét toàn bảng khi kiểm RESTRICT/SET NULL và thống kê câu hỏi)
-- và cho các truy vấn nóng: audit log mới nhất, thông báo theo người nhận, lượt thi/bài nộp theo trạng thái.

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_assignment_id_status_submitted_at_idx" ON "assignment_submissions"("assignment_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "ai_grading_suggestions_submission_id_idx" ON "ai_grading_suggestions"("submission_id");

-- CreateIndex
CREATE INDEX "exam_questions_question_id_idx" ON "exam_questions"("question_id");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_id_status_submitted_at_idx" ON "exam_attempts"("exam_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "attempt_answers_question_id_idx" ON "attempt_answers"("question_id");

-- CreateIndex
CREATE INDEX "forum_topics_author_id_idx" ON "forum_topics"("author_id");

-- CreateIndex
CREATE INDEX "forum_posts_author_id_idx" ON "forum_posts"("author_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_assignee_id_idx" ON "support_tickets"("assignee_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "chat_messages_reply_to_id_idx" ON "chat_messages"("reply_to_id");
