import { Module } from "@nestjs/common";
import { ContentController } from "./content.controller.js";
import { CourseController } from "./course.controller.js";
import { EngagementController } from "./engagement.controller.js";
import { LearningService } from "./learning.service.js";
import { AcademicController } from "./academic.controller.js";
import { AcademicService } from "./academic.service.js";
import { ExamAttemptReconciliationService } from "./exam-attempt-reconciliation.service.js";
import { SystemModule } from "../system/system.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { AiGenerationRequestService } from "./ai-generation-request.service.js";
import { AiMaterialContextService } from "./ai-material-context.service.js";

@Module({
  imports: [SystemModule],
  controllers: [CourseController, ContentController, EngagementController, AcademicController, ChatController],
  providers: [LearningService, AcademicService, ExamAttemptReconciliationService, ChatService, AiGenerationRequestService, AiMaterialContextService],
  exports: [LearningService],
})
/** Tập hợp API khóa học, nội dung, tương tác, học vụ và tác vụ nền của miền đào tạo. */
export class LearningModule {}
