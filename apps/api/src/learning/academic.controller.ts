import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequireAuthentication, RequirePermissions } from "../auth/require-permissions.decorator.js";
import { AcademicService, type AcademicCalendarEvent, type AssignmentSubmissionView, type AssignmentView, type ClassAnnouncementView, type GradebookRow } from "./academic.service.js";
import { AcademicQueryDto, CreateAnnouncementDto, CreateAssignmentDto, GradeAssignmentDto, SubmitAssignmentDto } from "./academic.dto.js";

@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get("academic/assignments") @RequireAuthentication()
  assignments(@Query() query: AcademicQueryDto, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentView[]> { return this.academic.listAssignments(session, query.classId); }

  @Post("instructor/classes/:classId/assignments") @RequirePermissions("exam:manage")
  createAssignment(@Param("classId") classId: string, @Body() input: CreateAssignmentDto, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentView> { return this.academic.createAssignment(classId, input, session); }

  @Post("instructor/assignments/:assignmentId/publish") @RequirePermissions("exam:manage")
  publishAssignment(@Param("assignmentId") assignmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentView> { return this.academic.publishAssignment(assignmentId, session); }

  @Post("learner/assignments/:assignmentId/submissions") @RequirePermissions("exam:view")
  submitAssignment(@Param("assignmentId") assignmentId: string, @Body() input: SubmitAssignmentDto, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentSubmissionView> { return this.academic.submitAssignment(assignmentId, input.content, session); }

  @Get("instructor/assignments/:assignmentId/submissions") @RequirePermissions("exam:manage")
  submissions(@Param("assignmentId") assignmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentSubmissionView[]> { return this.academic.listSubmissions(assignmentId, session); }

  @Patch("instructor/assignment-submissions/:submissionId/grade") @RequirePermissions("exam:manage")
  grade(@Param("submissionId") submissionId: string, @Body() input: GradeAssignmentDto, @CurrentSession() session: AuthenticatedSession): Promise<AssignmentSubmissionView> { return this.academic.gradeSubmission(submissionId, input.rubricScores, input.feedback, session); }

  @Get("academic/classes/:classId/gradebook") @RequirePermissions("report:view")
  gradebook(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<GradebookRow[]> { return this.academic.gradebook(classId, session); }

  @Get("academic/calendar") @RequireAuthentication()
  calendar(@Query() query: AcademicQueryDto, @CurrentSession() session: AuthenticatedSession): Promise<AcademicCalendarEvent[]> { return this.academic.calendar(session, query.classId); }

  @Get("academic/announcements") @RequireAuthentication()
  announcements(@Query() query: AcademicQueryDto, @CurrentSession() session: AuthenticatedSession): Promise<ClassAnnouncementView[]> { return this.academic.listAnnouncements(session, query.classId); }

  @Post("academic/classes/:classId/announcements") @RequireAuthentication()
  createAnnouncement(@Param("classId") classId: string, @Body() input: CreateAnnouncementDto, @CurrentSession() session: AuthenticatedSession): Promise<ClassAnnouncementView> { return this.academic.createAnnouncement(classId, input.title, input.body, session); }
}
