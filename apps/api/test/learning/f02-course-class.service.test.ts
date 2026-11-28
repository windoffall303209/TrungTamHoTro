import { describe, expect, it } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { createLearningTestRuntime } from "../../src/domains/learning/core/learning-runtime.service.js";
import { CourseClassService } from "../../src/domains/learning/courses/course-class.service.js";

describe("F02a CourseClassService & LearningRuntimeService boundary", () => {
  it("cô lập hoàn toàn trạng thái in-memory giữa hai phiên bản runtime kiểm thử", async () => {
    const runtimeA = createLearningTestRuntime();
    const runtimeB = createLearningTestRuntime();
    const serviceA = new CourseClassService(runtimeA);
    const serviceB = new CourseClassService(runtimeB);

    const created = await serviceA.createCourse(
      {
        code: "F02-ISOLATION",
        name: "Khóa học cô lập F02",
        description: "Xác nhận không rò trạng thái in-memory giữa các test.",
        outcomes: ["Tách ranh giới rõ ràng"],
      },
      "usr-manager",
    );

    const coursesA = await serviceA.listCourses();
    const coursesB = await serviceB.listCourses();
    expect(coursesA.some((item) => item.id === created.id)).toBe(true);
    expect(coursesB.some((item) => item.id === created.id)).toBe(false);
  });

  it("không nạp mảng fixture demo khi Prisma ở trạng thái kết nối production", () => {
    const fakeActivePrisma = {
      isStartupConnectionEnabled: (): boolean => true,
    } as unknown as PrismaService;
    const runtime = createLearningTestRuntime({ prisma: fakeActivePrisma });

    expect(runtime.memoryState.courses).toHaveLength(0);
    expect(runtime.memoryState.classes).toHaveLength(0);
    expect(runtime.memoryState.materials).toHaveLength(0);
    expect(runtime.memoryState.questions).toHaveLength(0);
    expect(runtime.memoryState.exams).toHaveLength(0);
  });

  it("chạy trọn vòng đời khóa học → xuất bản → mở lớp → kích hoạt trực tiếp qua CourseClassService", async () => {
    const service = new CourseClassService(createLearningTestRuntime());
    const draft = await service.createCourse(
      {
        code: "F02-SLICE",
        name: "Kiến trúc mô-đun F02",
        description: "Kiểm thử lát cắt CourseClassService độc lập với LearningService.",
        outcomes: ["Tách service theo domain"],
      },
      "usr-manager",
    );
    const published = await service.publishCourse(draft.id, "usr-manager");
    expect(published.status).toBe("PUBLISHED");

    const versions = await service.listCourseVersions(draft.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);

    const createdClass = await service.createClass(
      {
        courseId: draft.id,
        code: "F02-K01",
        name: "Lớp F02 K01",
        term: "2026-HK2",
        startAt: "2026-09-01T01:00:00.000Z",
        endAt: "2026-12-20T10:00:00.000Z",
        capacity: 30,
      },
      "usr-manager",
    );
    expect(createdClass.status).toBe("DRAFT");

    const withInstructor = await service.assignInstructor(
      createdClass.id,
      "usr-instructor",
      "PRIMARY",
      "usr-manager",
    );
    expect(withInstructor.instructorIds).toContain("usr-instructor");

    const active = await service.activateClass(createdClass.id, "usr-manager");
    expect(active.status).toBe("ACTIVE");

    const fetched = await service.getClassById(createdClass.id, "INSTRUCTOR", "usr-instructor");
    expect(fetched.id).toBe(createdClass.id);
  });
});
