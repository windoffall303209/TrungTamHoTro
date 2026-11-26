import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { parseOptionalQueryInt, parseOptionalQueryString, parsePageQuery, type PaginatedResult } from "../../../common/pagination.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication, RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import { USER_FILE_CSP } from "../../../infrastructure/file-signature.js";
import { ArchiveCourseDto, AssignInstructorDto, AssignUserDto, BulkEnrollmentDto, CloseClassDto, CreateClassDto, CreateCourseDto, DirectoryQueryDto, RemoveMemberDto, ReopenClassDto, TransferPrimaryInstructorDto, UpdateClassDto, UpdateCourseDto } from "../core/learning.dto.js";
import { CourseClassService } from "./course-class.service.js";
import type { ClassCapabilities, ClassRoster, CourseVersionSnapshot, DirectoryUser, EnrollmentImportResult, LearningClass, LearningCourse } from "../core/learning.types.js";

/** Chuẩn hóa tham số status tùy chọn theo tập giá trị hợp lệ của khóa học hoặc lớp học. */
function parseStatusFilter<T extends string>(rawValue: unknown, allowed: readonly T[]): T | undefined {
  const normalized = parseOptionalQueryString(rawValue, "status", 64)?.toUpperCase();
  if (!normalized) return undefined;
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new BadRequestException("Tham số status không hợp lệ.");
  }
  return normalized as T;
}

@ApiTags("Course & Class")
@Controller()
/** API quản lý vòng đời khóa học, lớp, giảng viên và ghi danh học viên. */
export class CourseController {
  constructor(private readonly learning: CourseClassService) {}

  @Get("manager/courses") @RequirePermissions("course:view")
  /** Liệt kê danh mục khóa học; người không có course:manage chỉ thấy khóa học đã xuất bản. */
  async listCourses(@CurrentSession() session: AuthenticatedSession): Promise<LearningCourse[]> {
    const courses = await this.learning.listCourses();
    return session.permissions.includes("course:manage") ? courses : courses.filter((course) => course.status === "PUBLISHED");
  }

  @Get("manager/courses/page") @RequirePermissions("course:view")
  /** Trả danh mục khóa học phân trang; người không có course:manage bị ép lọc trạng thái PUBLISHED. */
  listCoursesPage(@Query() raw: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession): Promise<PaginatedResult<LearningCourse>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    const requestedStatus = parseStatusFilter(raw.status, ["DRAFT", "PUBLISHED", "ARCHIVED"] as const);
    return this.learning.listCoursesPage({
      query: parseOptionalQueryString(raw.query, "query", 255),
      grade: parseOptionalQueryInt(raw.grade, "grade", 1, 12),
      subject: parseOptionalQueryString(raw.subject, "subject", 100),
      status: session.permissions.includes("course:manage") ? requestedStatus : "PUBLISHED",
      page,
      pageSize,
    });
  }

  @Post("manager/courses") @RequirePermissions("course:manage")
  /** Tạo khóa học nháp và ghi actor từ phiên hiện tại. */
  createCourse(@Body() input: CreateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.createCourse(input, session.user.id); }

  @Post("manager/courses/:courseId/publish") @RequirePermissions("course:manage")
  /** Xuất bản khóa học và chốt snapshot phiên bản nội dung. */
  publishCourse(@Param("courseId") courseId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.publishCourse(courseId, session.user.id); }

  @Patch("manager/courses/:courseId") @RequirePermissions("course:manage")
  /** Cập nhật nội dung khóa học theo quy tắc trạng thái trong service. */
  updateCourse(@Param("courseId") courseId: string, @Body() input: UpdateCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.updateCourse(courseId, input, session.user.id); }

  @Get("manager/courses/:courseId/versions") @RequirePermissions("course:manage")
  /** Đọc lịch sử snapshot của các lần xuất bản khóa học. */
  listCourseVersions(@Param("courseId") courseId: string): Promise<CourseVersionSnapshot[]> { return this.learning.listCourseVersions(courseId); }

  @Post("manager/courses/:courseId/archive") @RequirePermissions("course:manage")
  /** Ngừng sử dụng khóa học với lý do được lưu vào audit. */
  archiveCourse(@Param("courseId") courseId: string, @Body() input: ArchiveCourseDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningCourse> { return this.learning.archiveCourse(courseId, input.reason, session.user.id); }

  @Get("classes") @RequirePermissions("class:view")
  /** Liệt kê lớp theo vai trò và quan hệ thành viên của phiên. */
  listClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> { return this.learning.listClasses(session.roleCode, session.user.id); }

  @Get("classes/page") @RequirePermissions("class:view")
  /** Trả danh sách lớp học phân trang theo quyền phiên và bộ lọc từ DB. */
  listClassesPage(@Query() raw: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession): Promise<PaginatedResult<LearningClass>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    return this.learning.listClassesPage(session.roleCode, session.user.id, {
      query: parseOptionalQueryString(raw.query, "query", 255),
      grade: parseOptionalQueryInt(raw.grade, "grade", 1, 12),
      subject: parseOptionalQueryString(raw.subject, "subject", 100),
      courseId: parseOptionalQueryString(raw.courseId, "courseId", 191),
      status: parseStatusFilter(raw.status, ["DRAFT", "ACTIVE", "CLOSED"] as const),
      page,
      pageSize,
    });
  }

  @Get("classes/:classId") @RequirePermissions("class:view")
  /** Trả hồ sơ một lớp duy nhất theo quyền truy cập của phiên, thay cho tải toàn danh sách lớp. */
  getClassById(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> {
    return this.learning.getClassById(classId, session.roleCode, session.user.id);
  }

  @Get("instructor/classes") @RequirePermissions("class:view")
  /** Liệt kê riêng các lớp giảng viên hiện tại được phân công. */
  listInstructorClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> {
    if (session.roleCode !== "INSTRUCTOR") throw new ForbiddenException("Chỉ giảng viên mới được xem danh sách lớp giảng dạy.");
    return this.learning.listClasses("INSTRUCTOR", session.user.id);
  }

  @Get("instructor/classes/:classId/learners") @RequirePermissions("session:manage")
  /** Trả danh sách học viên của lớp sau khi xác minh giảng viên phụ trách. */
  listInstructorClassLearners(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<DirectoryUser[]> {
    if (session.roleCode !== "INSTRUCTOR") throw new ForbiddenException("Chỉ giảng viên mới được xem danh sách học viên lớp phụ trách.");
    return this.learning.listInstructorClassLearners(classId, session.user.id);
  }

  @Get("learner/classes") @RequirePermissions("class:view")
  /** Liệt kê các lớp học viên hiện tại đã ghi danh. */
  listLearnerClasses(@CurrentSession() session: AuthenticatedSession): Promise<LearningClass[]> {
    if (session.roleCode !== "LEARNER") throw new ForbiddenException("Chỉ học viên mới được xem danh sách lớp đã ghi danh.");
    return this.learning.listClasses("LEARNER", session.user.id);
  }

  @Get("classes/:classId/capabilities") @RequirePermissions("class:view")
  /** Trả ma trận thao tác theo quyền thực tế, quan hệ lớp và trạng thái hiện tại. */
  getClassCapabilities(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<ClassCapabilities> { return this.learning.getClassCapabilities(classId, session); }

  @Post("manager/classes") @RequirePermissions("class:manage")
  /** Mở lớp nháp từ phiên bản khóa học được chọn. */
  createClass(@Body() input: CreateClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.createClass(input, session.user.id); }

  @Patch("manager/classes/:classId") @RequirePermissions("class:manage")
  /** Cập nhật thông tin và cài đặt lớp học. */
  updateClass(@Param("classId") classId: string, @Body() input: UpdateClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.updateClass(classId, input, session.user.id); }

  @Patch("classes/:classId/settings") @RequireAuthentication()
  /** Cho phép giảng viên phụ trách hoặc quản lý cập nhật toàn bộ cài đặt lớp học. */
  updateClassSettings(@Param("classId") classId: string, @Body() input: UpdateClassDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> {
    return this.learning.updateClassSettings(classId, input, session);
  }

  @Post("classes/:classId/avatar")
  @RequireAuthentication()
  @UseInterceptors(FileInterceptor("file", { limits: { files: 1, fileSize: 3 * 1024 * 1024 } }))
  /** Tải ảnh đại diện tùy chỉnh cho lớp học (giảng viên phụ trách hoặc quản lý). */
  uploadClassAvatar(
    @Param("classId") classId: string,
    @UploadedFile() file: { mimetype: string; size: number; buffer?: Buffer } | undefined,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<LearningClass> {
    if (!file?.buffer) throw new BadRequestException("Vui lòng chọn tệp ảnh đại diện lớp học.");
    return this.learning.updateClassAvatar(classId, { mimeType: file.mimetype, size: file.size, buffer: file.buffer }, session);
  }

  @Delete("classes/:classId/avatar")
  @RequireAuthentication()
  /** Gỡ ảnh đại diện tùy chỉnh của lớp học để quay về icon mặc định. */
  removeClassAvatar(
    @Param("classId") classId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<LearningClass> {
    return this.learning.removeClassAvatar(classId, session);
  }

  @Get("classes/:classId/avatar")
  @RequireAuthentication()
  @Header("Content-Security-Policy", USER_FILE_CSP)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800")
  /** Phát ảnh đại diện lớp học theo luồng inline sau khi kiểm tra quyền xem lớp của phiên. */
  async classAvatar(
    @Param("classId") classId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    const avatar = await this.learning.readClassAvatar(classId, session);
    return new StreamableFile(avatar.buffer, { type: avatar.mimeType, disposition: "inline", length: avatar.buffer.length });
  }

  @Post("manager/classes/:classId/instructors") @RequirePermissions("class:manage")
  /** Phân công giảng viên với vai trò PRIMARY hoặc CO_INSTRUCTOR. */
  assignInstructor(@Param("classId") classId: string, @Body() input: AssignInstructorDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.assignInstructor(classId, input.userId, input.role, session.user.id); }

  @Post("manager/classes/:classId/instructors/transfer-primary") @RequirePermissions("class:manage")
  /** Bàn giao giảng viên chính nguyên tử và lưu đầy đủ nguồn, đích, lý do. */
  transferPrimaryInstructor(@Param("classId") classId: string, @Body() input: TransferPrimaryInstructorDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningClass> { return this.learning.transferPrimaryInstructor(classId, input.expectedPrimaryId, input.newPrimaryId, input.reason, session.user.id); }

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
