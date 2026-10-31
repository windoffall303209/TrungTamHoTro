import { Module } from "@nestjs/common";
import { ContentController } from "../content/content.controller.js";
import { CourseController } from "../courses/course.controller.js";
import { EngagementController } from "../engagement/engagement.controller.js";
import { LearningService } from "./learning.service.js";
import { AcademicController } from "../academic/academic.controller.js";
import { AcademicService } from "../academic/academic.service.js";
import { ExamAttemptReconciliationService } from "../exams/exam-attempt-reconciliation.service.js";
import { SystemModule } from "../../system/core/system.module.js";
import { ChatController } from "../chat/chat.controller.js";
import { ChatService } from "../chat/chat.service.js";
import { AiGenerationRequestService } from "../ai/ai-generation-request.service.js";
import { AiMaterialContextService } from "../ai/ai-material-context.service.js";
import { AiStudyDraftService } from "../ai/ai-study-draft.service.js";
import { AiGradingAssistService } from "../ai/ai-grading-assist.service.js";
import { AiGradingStoreService } from "../ai/ai-grading-store.service.js";
import { AiGradingOperationsController, AiGradingOperationsService } from "../ai/ai-grading-operations.js";

@Module({
  imports: [SystemModule],
  controllers: [CourseController, ContentController, EngagementController, AcademicController, ChatController, AiGradingOperationsController],
  providers: [LearningService, AcademicService, ExamAttemptReconciliationService, ChatService, AiGenerationRequestService, AiMaterialContextService, AiStudyDraftService, AiGradingAssistService, AiGradingStoreService, AiGradingOperationsService],
  exports: [LearningService],
})
/** Tập hợp API khóa học, nội dung, tương tác, học vụ và tác vụ nền của miền đào tạo. */
export class LearningModule {}
