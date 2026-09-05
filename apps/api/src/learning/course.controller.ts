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
/** API quản lý vòng đời khóa học, lớp, giảng viên và ghi danh học viên. */
export class CourseController {
  constructor(private readonly learning: LearningService) {}

  @Get("manager/courses") @RequirePermissions("course:view")
  /** Liệt kê danh mục khóa học cho khu vực quản lý. */
  listCourses(): Promise<LearningCourse[]> { return this.learning.listCourses(); }

  @Post("manager/courses") @RequirePermissions("course:manage")
  /** Tạo khóa học nháp và ghi actor từ phiên hiện tại. */
  createCourse(@Body() input: CreateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.createCourse(input, session.user.id); }

  @Post("manager/courses/:courseId/publish") @RequirePermissions("course:manage")
  /** Xuất bản khóa học và chốt snapshot phiên bản nội dung. */
  publishCourse(@Param("courseId") courseId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.publishCourse(courseId, session.user.id); }

  @Patch("manager/courses/:courseId") @RequirePermissions("course:manage")
  /** Cập nhật nội dung khóa học theo quy tắc trạng thái trong service. */
  updateCourse(@Param("courseId") courseId: string, @Body() input: UpdateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.updateCourse(courseId, input, session.user.id); }

  @Get("manager/courses/:courseId/versions") @RequirePermissions("course:view")
  /** Đọc lịch sử snapshot của các lần xuất bản khóa học. */
  listCourseVersions(@Param("courseId") courseId: string): Promise<CourseVersionSnapshot[]> { return this.learning.listCourseVersions(courseId); }

  @Post("manager/courses/:courseId/archive") @RequirePermissions("course:manage")
  /** Ngừng sử dụng khóa học với lý do được lưu vào audit. */
  archiveCourse(@Param("courseId") courseId: string, @Body() input: ArchiveCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.archiveCourse(courseId, input.reason, session.user.id); }

  @Get("classes") @RequirePermissions("class:view")
  /** Liệt kê lớp theo vai trò và quan hệ thành viên của phiên. */
  listClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses(session.roleCode, session.user.id); }

  @Get("instructor/classes") @RequirePermissions("class:view")
  /** Liệt kê riêng các lớp giảng viên hiện tại được phân công. */
  listInstructorClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses("INSTRUCTOR", session.user.id); }

  @Get("instructor/classes/:classId/learners") @RequirePermissions("session:manage")
  /** Trả danh sách học viên của lớp sau khi xác minh giảng viên phụ trách. */
  listInstructorClassLearners(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<DirectoryUser[]> { return this.learning.listInstructorClassLearners(classId, session.user.id); }

  @Get("learner/classes") @RequirePermissions("class:view")
  /** Liệt kê các lớp học viên hiện tại đã ghi danh. */
  listLearnerClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses("LEARNER", session.user.id); }

  @Post("manager/classes") @RequirePermissions("class:manage")
  /** Mở lớp nháp từ phiên bản khóa học được chọn. */
  createClass(@Body() input: CreateClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.createClass(input, session.user.id); }

  @Post("manager/classes/:classId/instructors") @RequirePermissions("class:manage")
  /** Phân công giảng viên với vai trò PRIMARY hoặc CO_INSTRUCTOR. */
  assignInstructor(@Param("classId") classId: string, @Body() input: AssignInstructorDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.assignInstructor(classId, input.userId, input.role, session.user.id); }

  @Patch("manager/classes/:classId/instructors/:instructorId/remove") @RequirePermissions("class:manage")
  /** Gỡ phân công giảng viên và lưu lý do vào lịch sử thành viên. */
  removeInstructor(@Param("classId") classId: string, @Param("instructorId") instructorId: string, @Body() input: RemoveMemberDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.removeInstructor(classId, instructorId, input.reason, session.user.id); }

  @Post("manager/classes/:classId/enrollments") @RequirePermissions("class:manage")
  /** Ghi danh một học viên vào lớp trong giới hạn sức chứa/trạng thái. */
  enrollLearner(@Param("classId") classId: string, @Body() input: AssignUserDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.enrollLearner(classId, input.userId, session.user.id); }

  @Post("manager/classes/:classId/enrollments/import") @RequirePermissions("class:manage")
  /** Ghi danh hàng loạt và trả kết quả độc lập cho từng userId. */
  importEnrollments(@Param("classId") classId: string, @Body() input: BulkEnrollmentDto, @CurrentSession() session: AuthenticatedSession): Promise<EnrollmentImportResult[]> { return this.learning.importEnrollments(classId, input.userIds, session.user.id); }

  @Patch("manager/classes/:classId/enrollments/:learnerId/remove") @RequirePermissions("class:manage")
  /** Hủy ghi danh học viên và lưu lý do cùng actor vào lịch sử. */
  removeEnrollment(@Param("classId") classId: string, @Param("learnerId") learnerId: string, @Body() input: RemoveMemberDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.removeEnrollment(classId, learnerId, input.reason, session.user.id); }

  @Get("manager/classes/:classId/roster") @RequirePermissions("class:manage")
  /** Trả roster chi tiết gồm giảng viên, học viên và lịch sử vòng đời. */
  getClassRoster(@Param("classId") classId: string): Promise<ClassRoster> { return this.learning.getClassRoster(classId); }

  @Get("manager/directory/users") @RequirePermissions("class:manage")
  /** Tìm người dùng phù hợp để phân công/ghi danh, có thể loại người đã thuộc lớp. */
  searchDirectory(@Query() query: DirectoryQueryDto): Promise<DirectoryUser[]> { return this.learning.searchDirectory(query.role, query.q, query.classId); }

  @Post("manager/classes/:classId/activate") @RequirePermissions("class:manage")
  /** Kích hoạt lớp khi đủ điều kiện vận hành. */
  activateClass(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.activateClass(classId, session.user.id); }

  @Post("manager/classes/:classId/close") @RequirePermissions("class:manage")
  /** Đóng lớp theo chính sách lưu trữ sau khi service kiểm tra blocker. */
  closeClass(@Param("classId") classId: string, @Body() input: CloseClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.closeClass(classId, input.closeReason, input.archivePolicy, session.user.id); }

  @Get("manager/classes/:classId/closure-readiness") @RequirePermissions("class:manage")
  /** Kiểm tra các đề mở, điểm chờ, buổi học và khiếu nại đang chặn đóng lớp. */
  getClassClosureReadiness(@Param("classId") classId: string): Promise<object> { return this.learning.getClassClosureReadiness(classId); }

  @Post("manager/classes/:classId/reopen") @RequirePermissions("class:manage")
  /** Mở lại lớp đã đóng và ghi nhận lý do quản trị. */
  reopenClass(@Param("classId") classId: string, @Body() input: ReopenClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.reopenClass(classId, input.reason, session.user.id); }
}
