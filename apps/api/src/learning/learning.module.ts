import { Module } from "@nestjs/common";
import { ContentController } from "./content.controller.js";
import { CourseController } from "./course.controller.js";
import { EngagementController } from "./engagement.controller.js";
import { LearningService } from "./learning.service.js";

@Module({
  controllers: [CourseController, ContentController, EngagementController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}

