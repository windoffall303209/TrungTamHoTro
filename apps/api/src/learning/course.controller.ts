import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ArchiveCourseDto, AssignInstructorDto, AssignUserDto, BulkEnrollmentDto, CloseClassDto, CreateClassDto, CreateCourseDto, DirectoryQueryDto, RemoveMemberDto, ReopenClassDto, UpdateCourseDto } from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { ClassRoster, CourseVersionSnapshot, DirectoryUser, EnrollmentImportResult, LearningClass, LearningCourse } from "./learning.types.js";

@ApiTags("Course & Class")
@Controller()
export class CourseController {
  constructor(private readonly learning: LearningService) {}

  @Get("manager/courses") @RequirePermissions("course:view")
  listCourses(): Promise<LearningCourse[]> { return this.learning.listCourses(); }

  @Post("manager/courses") @RequirePermissions("course:manage")
  createCourse(@Body() input: CreateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.createCourse(input, session.user.id); }

  @Post("manager/courses/:courseId/publish") @RequirePermissions("course:manage")
  publishCourse(@Param("courseId") courseId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.publishCourse(courseId, session.user.id); }

  @Patch("manager/courses/:courseId") @RequirePermissions("course:manage")
  updateCourse(@Param("courseId") courseId: string, @Body() input: UpdateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.updateCourse(courseId, input, session.user.id); }

  @Get("manager/courses/:courseId/versions") @RequirePermissions("course:view")
  listCourseVersions(@Param("courseId") courseId: string): Promise<CourseVersionSnapshot[]> { return this.learning.listCourseVersions(courseId); }

  @Post("manager/courses/:courseId/archive") @RequirePermissions("course:manage")
  archiveCourse(@Param("courseId") courseId: string, @Body() input: ArchiveCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.archiveCourse(courseId, input.reason, session.user.id); }

  @Get("classes") @RequirePermissions("class:view")
  listClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses(session.roleCode, session.user.id); }

  @Get("instructor/classes") @RequirePermissions("class:view")
  listInstructorClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses("INSTRUCTOR", session.user.id); }

  @Get("instructor/classes/:classId/learners") @RequirePermissions("session:manage")
  listInstructorClassLearners(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<DirectoryUser[]> { return this.learning.listInstructorClassLearners(classId, session.user.id); }

  @Get("learner/classes") @RequirePermissions("class:view")
  listLearnerClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses("LEARNER", session.user.id); }

  @Post("manager/classes") @RequirePermissions("class:manage")
  createClass(@Body() input: CreateClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.createClass(input, session.user.id); }

  @Post("manager/classes/:classId/instructors") @RequirePermissions("class:manage")
  assignInstructor(@Param("classId") classId: string, @Body() input: AssignInstructorDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.assignInstructor(classId, input.userId, input.role, session.user.id); }

  @Patch("manager/classes/:classId/instructors/:instructorId/remove") @RequirePermissions("class:manage")
  removeInstructor(@Param("classId") classId: string, @Param("instructorId") instructorId: string, @Body() input: RemoveMemberDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.removeInstructor(classId, instructorId, input.reason, session.user.id); }

  @Post("manager/classes/:classId/enrollments") @RequirePermissions("class:manage")
  enrollLearner(@Param("classId") classId: string, @Body() input: AssignUserDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.enrollLearner(classId, input.userId, session.user.id); }

  @Post("manager/classes/:classId/enrollments/import") @RequirePermissions("class:manage")
  importEnrollments(@Param("classId") classId: string, @Body() input: BulkEnrollmentDto, @CurrentSession() session: AuthenticatedSession): Promise<EnrollmentImportResult[]> { return this.learning.importEnrollments(classId, input.userIds, session.user.id); }

  @Patch("manager/classes/:classId/enrollments/:learnerId/remove") @RequirePermissions("class:manage")
  removeEnrollment(@Param("classId") classId: string, @Param("learnerId") learnerId: string, @Body() input: RemoveMemberDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.removeEnrollment(classId, learnerId, input.reason, session.user.id); }

  @Get("manager/classes/:classId/roster") @RequirePermissions("class:manage")
  getClassRoster(@Param("classId") classId: string): Promise<ClassRoster> { return this.learning.getClassRoster(classId); }

  @Get("manager/directory/users") @RequirePermissions("class:manage")
  searchDirectory(@Query() query: DirectoryQueryDto): Promise<DirectoryUser[]> { return this.learning.searchDirectory(query.role, query.q, query.classId); }

  @Post("manager/classes/:classId/activate") @RequirePermissions("class:manage")
  activateClass(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.activateClass(classId, session.user.id); }

  @Post("manager/classes/:classId/close") @RequirePermissions("class:manage")
  closeClass(@Param("classId") classId: string, @Body() input: CloseClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.closeClass(classId, input.closeReason, input.archivePolicy, session.user.id); }

  @Get("manager/classes/:classId/closure-readiness") @RequirePermissions("class:manage")
  getClassClosureReadiness(@Param("classId") classId: string): Promise<object> { return this.learning.getClassClosureReadiness(classId); }

  @Post("manager/classes/:classId/reopen") @RequirePermissions("class:manage")
  reopenClass(@Param("classId") classId: string, @Body() input: ReopenClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.reopenClass(classId, input.reason, session.user.id); }
}
