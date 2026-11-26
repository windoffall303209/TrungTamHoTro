import { Injectable, Optional } from "@nestjs/common";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import type { PaginatedResult } from "../../../common/pagination.js";
import { LearningRuntimeService } from "../core/learning-runtime.service.js";
import type {
  ClassCapabilities,
  ClassClosureReadiness,
  ClassRoster,
  CourseVersionSnapshot,
  DirectoryUser,
  EnrollmentImportResult,
  InstructorRole,
  LearningClass,
  LearningCourse,
} from "../core/learning.types.js";
import * as class_enrollments_ops from "../operations/classes/learning-class-enrollments.js";
import * as class_instructors_ops from "../operations/classes/learning-class-instructors.js";
import * as class_lifecycle_ops from "../operations/classes/learning-class-lifecycle.js";
import * as classes_ops from "../operations/classes/learning-classes.js";
import * as class_avatar_ops from "../operations/classes/learning-class-avatar.js";
import * as courses_ops from "../operations/courses/learning-courses.js";
import * as directory_ops from "../operations/directory/learning-directory.js";

@Injectable()
/** Service miền khóa học, lớp học, giảng viên, ghi danh và danh bạ thành viên lớp. */
export class CourseClassService {
  private readonly runtime: LearningRuntimeService;

  constructor(@Optional() runtime?: LearningRuntimeService) {
    this.runtime = runtime ?? new LearningRuntimeService();
  }

  /** Liệt kê khóa học từ DB hoặc bộ nhớ kiểm thử. */
  async listCourses(): Promise<LearningCourse[]> {
    return await courses_ops.listCourses(this.runtime.context);
  }

  /** Phân trang danh mục khóa học kèm tổng số bản ghi được lọc trực tiếp từ DB. */
  async listCoursesPage(
    filters: courses_ops.CoursePageFilters = {},
  ): Promise<PaginatedResult<LearningCourse>> {
    return await courses_ops.listCoursesPage(this.runtime.context, filters);
  }

  /** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
  async createCourse(
    input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes"> &
      Partial<Pick<LearningCourse, "grade" | "subject">>,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.createCourse(this.runtime.context, input, actorId);
  }

  /** Cập nhật nội dung khóa học; khóa học đã xuất bản sẽ tăng version theo quy tắc lưu lịch sử. */
  async updateCourse(
    courseId: string,
    input: Pick<LearningCourse, "name" | "description" | "outcomes">,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.updateCourse(this.runtime.context, courseId, input, actorId);
  }

  /** Liệt kê snapshot xuất bản của khóa học theo thứ tự phiên bản. */
  async listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]> {
    return await courses_ops.listCourseVersions(this.runtime.context, courseId);
  }

  /** Xuất bản khóa học và chụp snapshot bất biến của phiên bản hiện tại trong transaction. */
  async publishCourse(courseId: string, actorId: string): Promise<LearningCourse> {
    return await courses_ops.publishCourse(this.runtime.context, courseId, actorId);
  }

  /** Chuyển khóa học sang ARCHIVED sau khi kiểm tra ràng buộc sử dụng và lưu lý do audit. */
  async archiveCourse(
    courseId: string,
    reason: string,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.archiveCourse(this.runtime.context, courseId, reason, actorId);
  }

  /** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
  async listClasses(role: string, actorId: string): Promise<LearningClass[]> {
    return await classes_ops.listClasses(this.runtime.context, role, actorId);
  }

  /** Đọc chi tiết đúng một lớp học theo quyền và quan hệ thành viên của phiên hiện tại. */
  async getClassById(
    classId: string,
    role: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.getClassById(this.runtime.context, classId, role, actorId);
  }

  /** Phân trang danh sách lớp học theo vai trò và bộ lọc trực tiếp ở DB. */
  async listClassesPage(
    role: string,
    actorId: string,
    filters: classes_ops.ClassPageFilters = {},
  ): Promise<PaginatedResult<LearningClass>> {
    return await classes_ops.listClassesPage(this.runtime.context, role, actorId, filters);
  }

  /** Tính capability tại máy chủ từ quyền phiên, quan hệ lớp và trạng thái. */
  async getClassCapabilities(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<ClassCapabilities> {
    return await classes_ops.getClassCapabilities(this.runtime.context, classId, session);
  }

  /** Tạo lớp nháp từ phiên bản khóa học hợp lệ và kiểm tra lịch, sức chứa, múi giờ. */
  async createClass(
    input: Pick<
      LearningClass,
      "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
    > &
      Partial<
        Pick<
          LearningClass,
          | "timezone"
          | "allowLateEnrollment"
          | "allowPeerGradeViewing"
          | "allowLearnerFeedPosting"
          | "grade"
          | "subject"
        >
      >,
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.createClass(this.runtime.context, input, actorId);
  }

  /** Cập nhật thông tin và cài đặt lớp học. */
  async updateClass(
    classId: string,
    input: {
      name?: string;
      capacity?: number;
      allowLateEnrollment?: boolean;
      allowPeerGradeViewing?: boolean;
      allowLearnerFeedPosting?: boolean;
    },
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.updateClass(this.runtime.context, classId, input, actorId);
  }

  /** Cho phép giảng viên phụ trách hoặc quản lý cập nhật toàn bộ cài đặt lớp học. */
  async updateClassSettings(
    classId: string,
    input: {
      name?: string;
      capacity?: number;
      allowLateEnrollment?: boolean;
      allowPeerGradeViewing?: boolean;
      allowLearnerFeedPosting?: boolean;
    },
    session: AuthenticatedSession,
  ): Promise<LearningClass> {
    return await class_avatar_ops.updateClassSettings(this.runtime.context, classId, input, session);
  }

  /** Tải ảnh đại diện mới cho lớp học sau khi xác thực quyền, chữ ký ảnh và quét mã độc. */
  async updateClassAvatar(
    classId: string,
    upload: class_avatar_ops.ClassAvatarUpload,
    session: AuthenticatedSession,
  ): Promise<LearningClass> {
    return await class_avatar_ops.updateClassAvatar(this.runtime.context, classId, upload, session);
  }

  /** Xóa ảnh đại diện tùy chỉnh của lớp học để quay về icon mặc định. */
  async removeClassAvatar(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<LearningClass> {
    return await class_avatar_ops.removeClassAvatar(this.runtime.context, classId, session);
  }

  /** Đọc nội dung ảnh đại diện của lớp học từ object storage sau khi đối chiếu quyền xem lớp. */
  async readClassAvatar(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    return await class_avatar_ops.readClassAvatar(this.runtime.context, classId, session);
  }

  /** Gán giảng viên đúng role, bảo đảm người dùng có vai trò INSTRUCTOR và ghi lịch sử thành viên. */
  async assignInstructor(
    classId: string,
    instructorId: string,
    requestedRole: InstructorRole | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.assignInstructor(
      this.runtime.context,
      classId,
      instructorId,
      requestedRole,
      actorId,
    );
  }

  /** Bàn giao PRIMARY nguyên tử, chống hai yêu cầu đồng thời bằng người nguồn kỳ vọng. */
  async transferPrimaryInstructor(
    classId: string,
    expectedPrimaryId: string,
    newPrimaryId: string,
    rawReason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.transferPrimaryInstructor(
      this.runtime.context,
      classId,
      expectedPrimaryId,
      newPrimaryId,
      rawReason,
      actorId,
    );
  }

  /** Gỡ phân công giảng viên và bảo vệ điều kiện giảng viên chính. */
  async removeInstructor(
    classId: string,
    instructorId: string,
    reason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.removeInstructor(
      this.runtime.context,
      classId,
      instructorId,
      reason,
      actorId,
    );
  }

  /** Ghi danh học viên sau khi kiểm tra vai trò, trạng thái lớp, thời hạn và sức chứa. */
  async enrollLearner(
    classId: string,
    learnerId: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_enrollments_ops.enrollLearner(
      this.runtime.context,
      classId,
      learnerId,
      actorId,
    );
  }

  /** Ghi danh lần lượt danh sách userId và cô lập lỗi để trả kết quả trên từng học viên. */
  async importEnrollments(
    classId: string,
    userIds: string[],
    actorId: string,
  ): Promise<EnrollmentImportResult[]> {
    return await class_enrollments_ops.importEnrollments(
      this.runtime.context,
      classId,
      userIds,
      actorId,
    );
  }

  /** Hủy ghi danh và ghi nhận lý do trực tiếp trên bản ghi ghi danh lớp. */
  async removeEnrollment(
    classId: string,
    learnerId: string,
    reason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_enrollments_ops.removeEnrollment(
      this.runtime.context,
      classId,
      learnerId,
      reason,
      actorId,
    );
  }

  /** Tổng hợp giảng viên, ghi danh đang/cũ và lịch sử thao tác thành roster chi tiết. */
  async getClassRoster(classId: string): Promise<ClassRoster> {
    return await class_enrollments_ops.getClassRoster(this.runtime.context, classId);
  }

  /** Kích hoạt lớp khi khóa học đã xuất bản, lịch hợp lệ và có giảng viên chính. */
  async activateClass(classId: string, actorId: string): Promise<LearningClass> {
    return await class_lifecycle_ops.activateClass(this.runtime.context, classId, actorId);
  }

  /** Đếm các nghiệp vụ còn mở để xác định lớp có thể đóng hay chưa. */
  async getClassClosureReadiness(classId: string): Promise<ClassClosureReadiness> {
    return await class_lifecycle_ops.getClassClosureReadiness(this.runtime.context, classId);
  }

  /** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
  async closeClass(
    classId: string,
    closeReason: string,
    archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
    actorId: string,
  ): Promise<LearningClass> {
    return await class_lifecycle_ops.closeClass(
      this.runtime.context,
      classId,
      closeReason,
      archivePolicy,
      actorId,
    );
  }

  /** Mở lại lớp đã đóng, xóa thông tin đóng và ghi lý do vào audit. */
  async reopenClass(
    classId: string,
    rawReason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_lifecycle_ops.reopenClass(
      this.runtime.context,
      classId,
      rawReason,
      actorId,
    );
  }

  /** Xác minh giảng viên phụ trách rồi trả học viên đang ghi danh trong lớp. */
  async listInstructorClassLearners(
    classId: string,
    instructorId: string,
  ): Promise<DirectoryUser[]> {
    return await directory_ops.listInstructorClassLearners(
      this.runtime.context,
      classId,
      instructorId,
    );
  }

  /** Tìm người dùng theo vai trò và tùy chọn loại các thành viên đã thuộc lớp. */
  async searchDirectory(
    roleCode: "INSTRUCTOR" | "LEARNER",
    query = "",
    classId?: string,
  ): Promise<DirectoryUser[]> {
    return await directory_ops.searchDirectory(this.runtime.context, roleCode, query, classId);
  }
}
