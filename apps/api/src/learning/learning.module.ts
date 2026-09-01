import { Module } from "@nestjs/common";
import { ContentController } from "./content.controller.js";
import { CourseController } from "./course.controller.js";
import { EngagementController } from "./engagement.controller.js";
import { LearningService } from "./learning.service.js";
import { AcademicController } from "./academic.controller.js";
import { AcademicService } from "./academic.service.js";
import { ExamAttemptReconciliationService } from "./exam-attempt-reconciliation.service.js";
import { SystemModule } from "../system/system.module.js";

@Module({
  imports: [SystemModule],
  controllers: [CourseController, ContentController, EngagementController, AcademicController],
  providers: [LearningService, AcademicService, ExamAttemptReconciliationService],
  exports: [LearningService],
})
export class LearningModule {}
