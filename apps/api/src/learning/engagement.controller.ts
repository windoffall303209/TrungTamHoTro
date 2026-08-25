import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import {
  AttachRecordingDto, CreatePostDto, CreateReportDto, CreateSessionDto, CreateTicketDto,
  CreateTopicDto, ResolveReportDto, TransitionSessionDto, UpdateAttendanceDto, UpdateTicketDto,
} from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { ContentReport, ForumPost, ForumTopic, LiveSession, SupportTicket } from "./learning.types.js";

@ApiTags("Forum, Live Class & Support")
@Controller()
export class EngagementController {
  constructor(private readonly learning: LearningService) {}

  @Get("forum/topics") @RequirePermissions("forum:view")
  listTopics(): ForumTopic[] { return this.learning.listTopics(); }

  @Post("instructor/classes/:classId/forum/topics") @RequirePermissions("forum:moderate")
  createTopic(@Param("classId") classId: string, @Body() input: CreateTopicDto): ForumTopic { return this.learning.createTopic(classId, input); }

  @Get("forum/topics/:topicId/posts") @RequirePermissions("forum:view")
  listPosts(@Param("topicId") topicId: string): ForumPost[] { return this.learning.listPosts(topicId); }

  @Post("learner/forum/topics/:topicId/posts") @RequirePermissions("forum:post")
  createPost(@Param("topicId") topicId: string, @Body() input: CreatePostDto): ForumPost { return this.learning.createPost(topicId, input.body, "usr-learner", input.parentId); }

  @Post("learner/content-reports") @RequirePermissions("forum:view")
  reportContent(@Body() input: CreateReportDto): ContentReport { return this.learning.reportContent({ ...input, reporterId: "usr-learner" }); }

  @Get("manager/forum/reports") @RequirePermissions("forum:moderate")
  listReports(): ContentReport[] { return this.learning.listReports(); }

  @Post("manager/forum/reports/:reportId/resolve") @RequirePermissions("forum:moderate")
  resolveReport(@Param("reportId") reportId: string, @Body() input: ResolveReportDto): ContentReport { return this.learning.resolveReport(reportId, input.status, input.resolution); }

  @Get("sessions") @RequirePermissions("session:view")
  listSessions(): LiveSession[] { return this.learning.listSessions(); }

  @Post("instructor/classes/:classId/sessions") @RequirePermissions("session:manage")
  createSession(@Param("classId") classId: string, @Body() input: CreateSessionDto): LiveSession { return this.learning.createSession(classId, input); }

  @Patch("instructor/sessions/:sessionId/status") @RequirePermissions("session:manage")
  transitionSession(@Param("sessionId") sessionId: string, @Body() input: TransitionSessionDto): LiveSession { return this.learning.transitionSession(sessionId, input.status); }

  @Post("learner/sessions/:sessionId/join") @RequirePermissions("session:view")
  joinSession(@Param("sessionId") sessionId: string): object { return this.learning.joinSession(sessionId); }

  @Patch("instructor/sessions/:sessionId/attendance") @RequirePermissions("session:manage")
  updateAttendance(@Param("sessionId") sessionId: string, @Body() input: UpdateAttendanceDto): object { return this.learning.updateAttendance(sessionId, input.learnerId, input.status, input.attendedMinutes, input.adjustmentReason); }

  @Post("instructor/sessions/:sessionId/recordings") @RequirePermissions("session:manage")
  attachRecording(@Param("sessionId") sessionId: string, @Body() input: AttachRecordingDto): LiveSession { return this.learning.attachRecording(sessionId, input.recordingUrl); }

  @Get("learner/sessions/:sessionId/summary") @RequirePermissions("session:view")
  getSessionSummary(@Param("sessionId") sessionId: string): object { return this.learning.getSessionSummary(sessionId); }

  @Get("support/tickets")
  listTickets(@Headers("x-role-code") role = "LEARNER"): SupportTicket[] { return this.learning.listTickets(role); }

  @Post("support/tickets") @RequirePermissions("support:create")
  createTicket(@Body() input: CreateTicketDto): SupportTicket { return this.learning.createTicket(input); }

  @Patch("admin/support/tickets/:ticketId") @RequirePermissions("support:manage")
  updateTicket(@Param("ticketId") ticketId: string, @Body() input: UpdateTicketDto): SupportTicket { return this.learning.updateTicket(ticketId, input); }

  @Get("reports/operations") @RequirePermissions("report:view")
  getOperationalReport(): object { return this.learning.getOperationalReport(); }
}

