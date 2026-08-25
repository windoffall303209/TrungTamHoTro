import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ArchiveCourseDto, AssignInstructorDto, AssignUserDto, BulkEnrollmentDto, CloseClassDto, CreateClassDto, CreateCourseDto, RemoveMemberDto, ReopenClassDto, UpdateCourseDto } from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { ClassRoster, CourseVersionSnapshot, EnrollmentImportResult, LearningClass, LearningCourse } from "./learning.types.js";

@ApiTags("Course & Class")
@Controller()
export class CourseController {
  constructor(private readonly learning: LearningService) {}

  @Get("manager/courses") @RequirePermissions("course:view")
  listCourses(): Promise<LearningCourse[]> { return this.learning.listCourses(); }

  @Post("manager/courses") @RequirePermissions("course:manage")
  createCourse(@Body() input: CreateCourseDto): Promise<LearningCourse> { return this.learning.createCourse(input); }

  @Post("manager/courses/:courseId/publish") @RequirePermissions("course:manage")
  publishCourse(@Param("courseId") courseId: string): Promise<LearningCourse> { return this.learning.publishCourse(courseId); }

  @Patch("manager/courses/:courseId") @RequirePermissions("course:manage")
  updateCourse(@Param("courseId") courseId: string, @Body() input: UpdateCourseDto): Promise<LearningCourse> { return this.learning.updateCourse(courseId, input); }

  @Get("manager/courses/:courseId/versions") @RequirePermissions("course:view")
  listCourseVersions(@Param("courseId") courseId: string): Promise<CourseVersionSnapshot[]> { return this.learning.listCourseVersions(courseId); }

  @Post("manager/courses/:courseId/archive") @RequirePermissions("course:manage")
  archiveCourse(@Param("courseId") courseId: string, @Body() input: ArchiveCourseDto): Promise<LearningCourse> { return this.learning.archiveCourse(courseId, input.reason); }

  @Get("classes") @RequirePermissions("class:view")
  listClasses(@Headers("x-role-code") role = "LEARNER"): Promise<LearningClass[]> { return this.learning.listClasses(role); }

  @Get("instructor/classes") @RequirePermissions("class:view")
  listInstructorClasses(): Promise<LearningClass[]> { return this.learning.listClasses("INSTRUCTOR"); }

  @Get("learner/classes") @RequirePermissions("class:view")
  listLearnerClasses(): Promise<LearningClass[]> { return this.learning.listClasses("LEARNER"); }

  @Post("manager/classes") @RequirePermissions("class:manage")
  createClass(@Body() input: CreateClassDto): Promise<LearningClass> { return this.learning.createClass(input); }

  @Post("manager/classes/:classId/instructors") @RequirePermissions("class:manage")
  assignInstructor(@Param("classId") classId: string, @Body() input: AssignInstructorDto): Promise<LearningClass> { return this.learning.assignInstructor(classId, input.userId, input.role); }

  @Patch("manager/classes/:classId/instructors/:instructorId/remove") @RequirePermissions("class:manage")
  removeInstructor(@Param("classId") classId: string, @Param("instructorId") instructorId: string, @Body() input: RemoveMemberDto): Promise<LearningClass> { return this.learning.removeInstructor(classId, instructorId, input.reason); }

  @Post("manager/classes/:classId/enrollments") @RequirePermissions("class:manage")
  enrollLearner(@Param("classId") classId: string, @Body() input: AssignUserDto): Promise<LearningClass> { return this.learning.enrollLearner(classId, input.userId); }

  @Post("manager/classes/:classId/enrollments/import") @RequirePermissions("class:manage")
  importEnrollments(@Param("classId") classId: string, @Body() input: BulkEnrollmentDto): Promise<EnrollmentImportResult[]> { return this.learning.importEnrollments(classId, input.userIds); }

  @Patch("manager/classes/:classId/enrollments/:learnerId/remove") @RequirePermissions("class:manage")
  removeEnrollment(@Param("classId") classId: string, @Param("learnerId") learnerId: string, @Body() input: RemoveMemberDto): Promise<LearningClass> { return this.learning.removeEnrollment(classId, learnerId, input.reason); }

  @Get("manager/classes/:classId/roster") @RequirePermissions("class:manage")
  getClassRoster(@Param("classId") classId: string): Promise<ClassRoster> { return this.learning.getClassRoster(classId); }

  @Post("manager/classes/:classId/activate") @RequirePermissions("class:manage")
  activateClass(@Param("classId") classId: string): Promise<LearningClass> { return this.learning.activateClass(classId); }

  @Post("manager/classes/:classId/close") @RequirePermissions("class:manage")
  closeClass(@Param("classId") classId: string, @Body() input: CloseClassDto): Promise<LearningClass> { return this.learning.closeClass(classId, input.closeReason, input.archivePolicy); }

  @Get("manager/classes/:classId/closure-readiness") @RequirePermissions("class:manage")
  getClassClosureReadiness(@Param("classId") classId: string): Promise<object> { return this.learning.getClassClosureReadiness(classId); }

  @Post("manager/classes/:classId/reopen") @RequirePermissions("class:manage")
  reopenClass(@Param("classId") classId: string, @Body() input: ReopenClassDto): Promise<LearningClass> { return this.learning.reopenClass(classId, input.reason); }
}
