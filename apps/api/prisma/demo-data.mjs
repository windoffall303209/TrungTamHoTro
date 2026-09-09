const ANCHOR = new Date("2026-08-30T00:00:00.000Z");

const DAY = 86_400_000;
const addDays = (days, hour = 0) => new Date(ANCHOR.getTime() + days * DAY + hour * 3_600_000);
const pad = (value, width = 2) => String(value).padStart(width, "0");
const chunk = (rows, size = 500) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));

async function createMany(prismaModel, rows) {
  for (const batch of chunk(rows)) await prismaModel.createMany({ data: batch, skipDuplicates: true });
}

const courseDefinitions = [
  { code: "WEB-FULLSTACK", name: "Phát triển Web Full-stack", description: "Xây dựng sản phẩm web từ thiết kế giao diện, API đến triển khai.", outcomes: ["Thiết kế UI responsive", "Xây dựng REST API", "Vận hành ứng dụng web"] },
  { code: "DATA-FOUNDATION", name: "Nền tảng dữ liệu", description: "Tổ chức, làm sạch, phân tích và trực quan hóa dữ liệu.", outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu", "Xây dựng dashboard"] },
  { code: "UIUX-PRACTICE", name: "Thiết kế UI/UX thực chiến", description: "Nghiên cứu người dùng và thiết kế giao diện có khả năng sử dụng cao.", outcomes: ["Thiết kế luồng", "Xây dựng design system", "Kiểm thử usability"] },
  { code: "NODEJS-BACKEND", name: "Backend Node.js chuyên sâu", description: "Thiết kế dịch vụ backend an toàn, dễ kiểm thử và mở rộng.", outcomes: ["Thiết kế API", "Tối ưu truy vấn", "Quan sát hệ thống"] },
  { code: "MYSQL-DESIGN", name: "Thiết kế cơ sở dữ liệu MySQL", description: "Thiết kế lược đồ, chỉ mục và giao dịch cho hệ thống nghiệp vụ.", outcomes: ["Chuẩn hóa dữ liệu", "Tối ưu chỉ mục", "Kiểm soát giao dịch"] },
  { code: "CLOUD-DEVOPS", name: "Cloud & DevOps căn bản", description: "Tự động hóa kiểm thử, phát hành và giám sát ứng dụng.", outcomes: ["Xây dựng CI/CD", "Quản lý cấu hình", "Thiết lập giám sát"] },
  { code: "CYBER-SECURITY", name: "An toàn ứng dụng Web", description: "Nhận diện và xử lý các rủi ro bảo mật phổ biến của ứng dụng web.", outcomes: ["Threat modeling", "Bảo vệ xác thực", "Kiểm thử bảo mật"] },
  { code: "BUSINESS-ANALYSIS", name: "Phân tích nghiệp vụ hệ thống", description: "Chuyển nhu cầu vận hành thành yêu cầu và quy trình có thể triển khai.", outcomes: ["Mô hình hóa quy trình", "Đặc tả yêu cầu", "Thiết kế UAT"] },
];

const classDefinitions = [
  ["WEB-K01", "Web Full-stack K01", "WEB-FULLSTACK", "2026-HK1", "ACTIVE", -12, 112, 40],
  ["WEB-K02", "Web Full-stack K02", "WEB-FULLSTACK", "2026-HK2", "DRAFT", 35, 150, 36],
  ["DATA-K01", "Phân tích dữ liệu K01", "DATA-FOUNDATION", "2026-HK1", "ACTIVE", -26, 98, 42],
  ["DATA-K02", "Phân tích dữ liệu K02", "DATA-FOUNDATION", "2026-HK1", "ACTIVE", -8, 116, 38],
  ["UX-K01", "Thiết kế trải nghiệm K01", "UIUX-PRACTICE", "2026-HK1", "ACTIVE", -40, 76, 32],
  ["NODE-K01", "Backend Node.js K01", "NODEJS-BACKEND", "2026-HK1", "ACTIVE", -18, 104, 40],
  ["NODE-K02", "Backend Node.js K02", "NODEJS-BACKEND", "2025-HK2", "CLOSED", -240, -110, 35],
  ["DB-K01", "MySQL thực chiến K01", "MYSQL-DESIGN", "2026-HK1", "ACTIVE", -30, 94, 36],
  ["OPS-K01", "Cloud & DevOps K01", "CLOUD-DEVOPS", "2026-HK1", "ACTIVE", -5, 120, 34],
  ["SEC-K01", "An toàn Web K01", "CYBER-SECURITY", "2026-HK1", "ACTIVE", -22, 102, 34],
  ["BA-K01", "Phân tích nghiệp vụ K01", "BUSINESS-ANALYSIS", "2026-HK1", "ACTIVE", -15, 108, 40],
  ["BA-K02", "Phân tích nghiệp vụ K02", "BUSINESS-ANALYSIS", "2025-HK2", "CLOSED", -230, -100, 38],
];

const questionTemplates = [
  ["SINGLE_CHOICE", "Khái niệm nào phù hợp nhất với chủ đề {topic} trong tình huống thực tế?", ["Phương án A", "Phương án B", "Phương án C", "Phương án D"], ["Phương án B"]],
  ["MULTIPLE_CHOICE", "Những thực hành nào nên áp dụng khi triển khai {topic}?", ["Kiểm thử", "Ghi log", "Bỏ qua xác thực", "Theo dõi chỉ số"], ["Kiểm thử", "Ghi log", "Theo dõi chỉ số"]],
  ["TRUE_FALSE", "Có thể đánh giá chất lượng {topic} chỉ bằng một chỉ số duy nhất.", ["Đúng", "Sai"], ["Sai"]],
  ["SHORT_ANSWER", "Hãy nêu một rủi ro quan trọng khi áp dụng {topic}.", [], ["Câu trả lời được giảng viên chấm theo ý chính."]],
  ["ESSAY", "Phân tích cách áp dụng {topic} vào một dự án giáo dục trực tuyến.", [], ["Chấm theo rubric phân tích, giải pháp và lập luận."]],
];

export async function seedDemoData({ prisma, passwordHash, questionHash }) {
  const roles = new Map((await prisma.role.findMany()).map((role) => [role.code, role.id]));
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@wind.edu.vn" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@wind.edu.vn" } });

  const instructorInputs = Array.from({ length: 6 }, (_, index) => ({
    id: `demo-instructor-${pad(index + 1)}`,
    username: `giangvien${pad(index + 1)}@wind.edu.vn`,
    email: `giangvien${pad(index + 1)}@wind.edu.vn`,
    displayName: ["Phạm Ngọc Lan", "Vũ Đức Minh", "Đỗ Thùy Dương", "Bùi Quang Huy", "Hoàng Thanh Mai", "Nguyễn Gia Bảo"][index],
  }));
  const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương"];
  const middleNames = ["Minh", "Thu", "Hoàng", "Ngọc", "Thanh", "Gia", "Đức", "Khánh"];
  const givenNames = ["An", "Bình", "Chi", "Dũng", "Giang", "Hà", "Hải", "Hạnh", "Hiếu", "Hương", "Khang", "Linh", "Long", "Mai", "Nam", "Nga", "Phong", "Phương", "Quân", "Trang"];
  const learnerInputs = Array.from({ length: 60 }, (_, index) => ({
    id: `demo-learner-${pad(index + 1, 3)}`,
    username: `hocvien${pad(index + 1, 3)}@wind.edu.vn`,
    email: `hocvien${pad(index + 1, 3)}@wind.edu.vn`,
    displayName: `${familyNames[index % familyNames.length]} ${middleNames[(index * 3) % middleNames.length]} ${givenNames[(index * 7) % givenNames.length]}`,
  }));

  const instructorIds = [];
  for (const input of instructorInputs) {
    const user = await prisma.user.upsert({
      where: { email: input.email },
      update: { username: input.username, displayName: input.displayName, status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
      create: { ...input, phone: `0908${pad(instructorIds.length + 1, 6)}`, status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
    });
    instructorIds.push(user.id);
  }
  const learnerIds = [];
  for (const input of learnerInputs) {
    const user = await prisma.user.upsert({
      where: { email: input.email },
      update: { username: input.username, displayName: input.displayName, status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
      create: { ...input, status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
    });
    learnerIds.push(user.id);
  }
  const emptyLearner = await prisma.user.upsert({
    where: { email: "empty.learner@wind.edu.vn" },
    update: { username: "empty.learner@wind.edu.vn", displayName: "Học viên Chưa Ghi Danh", status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
    create: { id: "demo-learner-empty", username: "empty.learner@wind.edu.vn", email: "empty.learner@wind.edu.vn", displayName: "Học viên Chưa Ghi Danh", status: "ACTIVE", emailVerifiedAt: ANCHOR, passwordHash },
  });
  await createMany(prisma.userRole, [
    ...instructorIds.map((userId) => ({ userId, roleId: roles.get("INSTRUCTOR") })),
    ...learnerIds.map((userId) => ({ userId, roleId: roles.get("LEARNER") })),
    { userId: emptyLearner.id, roleId: roles.get("LEARNER") },
  ]);

  const courses = [];
  for (const [index, definition] of courseDefinitions.entries()) {
    const status = index === 7 ? "DRAFT" : "PUBLISHED";
    const course = await prisma.course.upsert({
      where: { code: definition.code },
      update: { name: definition.name, description: definition.description, outcomes: definition.outcomes, status },
      create: { id: `demo-course-${pad(index + 1)}`, ...definition, status, ownerId: manager.id },
    });
    courses.push(course);
    await prisma.courseVersion.upsert({
      where: { courseId_version: { courseId: course.id, version: 1 } },
      update: { name: course.name, description: course.description, outcomes: course.outcomes },
      create: { id: `demo-course-version-${pad(index + 1)}`, courseId: course.id, version: 1, name: course.name, description: course.description, outcomes: course.outcomes, publishedBy: manager.id, publishedAt: addDays(-90 + index) },
    });
  }
  const coursesByCode = new Map(courses.map((course) => [course.code, course]));

  const classes = [];
  for (const [index, [code, name, courseCode, term, status, startOffset, endOffset, capacity]] of classDefinitions.entries()) {
    const course = coursesByCode.get(courseCode);
    const learningClass = await prisma.learningClass.upsert({
      where: { code_term: { code, term } },
      update: { name, status, capacity, startAt: addDays(startOffset, 1), endAt: addDays(endOffset, 10) },
      create: { id: `demo-class-${pad(index + 1)}`, courseId: course.id, courseVersion: 1, code, name, term, status, startAt: addDays(startOffset, 1), endAt: addDays(endOffset, 10), capacity, allowLateEnrollment: index % 3 === 0, closedAt: status === "CLOSED" ? addDays(endOffset, 12) : null, archivePolicy: status === "CLOSED" ? "READ_ONLY" : null },
    });
    classes.push({ ...learningClass, courseCode, index });
  }

  const instructorLinks = [];
  const enrollments = [];
  const enrollmentHistory = [];
  for (const classInfo of classes) {
    const primaryId = instructorIds[classInfo.index % instructorIds.length];
    const coInstructorId = instructorIds[(classInfo.index + 2) % instructorIds.length];
    instructorLinks.push(
      { classId: classInfo.id, instructorId: primaryId, role: "PRIMARY", assignedBy: manager.id, assignedAt: addDays(-60 + classInfo.index) },
      { classId: classInfo.id, instructorId: coInstructorId, role: "CO_INSTRUCTOR", assignedBy: manager.id, assignedAt: addDays(-58 + classInfo.index) },
    );
    const enrollmentCount = Math.min(classInfo.capacity - 3, 24 + (classInfo.index % 9));
    for (let offset = 0; offset < enrollmentCount; offset += 1) {
      const learnerId = learnerIds[(classInfo.index * 5 + offset) % learnerIds.length];
      const status = classInfo.status === "CLOSED" ? "COMPLETED" : offset === enrollmentCount - 1 ? "PENDING" : "ACTIVE";
      enrollments.push({ id: `demo-enrollment-${pad(classInfo.index + 1)}-${pad(offset + 1, 3)}`, classId: classInfo.id, learnerId, status, joinedAt: addDays(-45 + offset % 12), source: offset % 4 === 0 ? "IMPORT" : "MANUAL" });
      enrollmentHistory.push({ id: `demo-enrollment-history-${pad(classInfo.index + 1)}-${pad(offset + 1, 3)}`, classId: classInfo.id, learnerId, action: "ADDED", source: offset % 4 === 0 ? "IMPORT" : "MANUAL", actorId: manager.id, createdAt: addDays(-45 + offset % 12) });
    }
  }
  await createMany(prisma.classInstructor, instructorLinks);
  await createMany(prisma.classEnrollment, enrollments);
  await createMany(prisma.classEnrollmentHistory, enrollmentHistory);

  const materials = [];
  const materialVersions = [];
  for (const classInfo of classes) {
    for (let index = 0; index < 6; index += 1) {
      const id = `demo-material-${pad(classInfo.index + 1)}-${pad(index + 1)}`;
      const version = index % 4 === 0 ? 2 : 1;
      const visibility = index === 5 ? "DRAFT" : index === 4 ? "HIDDEN" : "PUBLISHED";
      const material = { id, classId: classInfo.id, courseId: classInfo.courseId, ownerId: instructorIds[classInfo.index % instructorIds.length], name: `${pad(index + 1)} — ${["Giáo trình nền tảng", "Bài giảng minh họa", "Phiếu thực hành", "Tài liệu tham khảo", "Bản ghi buổi học", "Bản nháp nội bộ"][index]} — ${classInfo.code}.pdf`, objectKey: `seed/${classInfo.code.toLowerCase()}/material-${pad(index + 1)}.pdf`, mimeType: "application/pdf", sizeBytes: BigInt(1_200_000 + (classInfo.index * 6 + index) * 73_000), checksum: `sha256:demo-${pad(classInfo.index + 1)}-${pad(index + 1)}`, folder: `Tuần ${index + 1}`, tags: [classInfo.courseCode.toLowerCase(), `tuần-${index + 1}`], version, visibility, createdAt: addDays(-30 + index) };
      materials.push(material);
      for (let materialVersion = 1; materialVersion <= version; materialVersion += 1) materialVersions.push({ id: `${id}-v${materialVersion}`, materialId: id, version: materialVersion, name: material.name, objectKey: `${material.objectKey}.v${materialVersion}`, mimeType: material.mimeType, sizeBytes: material.sizeBytes, checksum: `${material.checksum}-v${materialVersion}`, folder: material.folder, tags: material.tags, visibility, createdBy: material.ownerId, createdAt: addDays(-31 + materialVersion) });
    }
  }
  await createMany(prisma.material, materials);
  await createMany(prisma.materialVersion, materialVersions);

  const questions = [];
  for (const [courseIndex, course] of courses.entries()) {
    for (let index = 0; index < 15; index += 1) {
      const template = questionTemplates[index % questionTemplates.length];
      const content = template[1].replace("{topic}", course.name.toLowerCase());
      const id = `demo-question-${pad(courseIndex + 1)}-${pad(index + 1)}`;
      questions.push({ id, courseId: course.id, authorId: instructorIds[courseIndex % instructorIds.length], type: template[0], content: `${content} (Tình huống ${index + 1})`, options: template[2], correctAnswers: template[3], difficulty: (index % 3) + 1, tags: [course.code.toLowerCase(), `mức-${(index % 3) + 1}`], status: index === 14 ? "DRAFT" : "PUBLISHED", version: 1, familyId: id, contentHash: questionHash(`${content} (Tình huống ${index + 1})`), createdAt: addDays(-50 + index) });
    }
  }
  await createMany(prisma.question, questions);
  const questionsByCourse = new Map(courses.map((course) => [course.id, questions.filter((question) => question.courseId === course.id && question.status === "PUBLISHED")]));

  const exams = [];
  const examQuestions = [];
  for (const classInfo of classes) {
    const courseQuestions = questionsByCourse.get(classInfo.courseId);
    for (let index = 0; index < 2; index += 1) {
      const id = `demo-exam-${pad(classInfo.index + 1)}-${index + 1}`;
      const status = classInfo.status === "DRAFT" && index === 1 ? "DRAFT" : index === 0 ? "PUBLISHED" : "CLOSED";
      exams.push({ id, classId: classInfo.id, title: `${index === 0 ? "Kiểm tra tiến độ" : "Đánh giá tổng hợp"} — ${classInfo.code}`, durationMinutes: index === 0 ? 30 : 60, totalScore: 10, openAt: addDays(index === 0 ? -4 : -35), closeAt: addDays(index === 0 ? 12 : -5, 23), attemptLimit: 2, shuffleQuestions: true, randomSeed: `${classInfo.code}-${index + 1}`, status, version: 1, createdAt: addDays(-45 + index) });
      for (let position = 0; position < 10; position += 1) examQuestions.push({ examId: id, questionId: courseQuestions[(index * 4 + position) % courseQuestions.length].id, position: position + 1, score: 1 });
    }
  }
  await createMany(prisma.exam, exams);
  await createMany(prisma.examQuestion, examQuestions);

  const attempts = [];
  const answers = [];
  const gradeHistory = [];
  for (const exam of exams.filter((item) => item.status !== "DRAFT")) {
    const classInfo = classes.find((item) => item.id === exam.classId);
    const activeLearners = enrollments.filter((item) => item.classId === classInfo.id && item.status !== "PENDING").slice(0, 18);
    const assignedQuestions = examQuestions.filter((item) => item.examId === exam.id);
    for (const [learnerIndex, enrollment] of activeLearners.entries()) {
      const id = `${exam.id}-attempt-${pad(learnerIndex + 1, 3)}`;
      const status = learnerIndex % 9 === 0 ? "IN_PROGRESS" : learnerIndex % 5 === 0 ? "SUBMITTED" : "GRADED";
      const score = status === "GRADED" ? 5 + (learnerIndex % 6) : null;
      attempts.push({ id, examId: exam.id, learnerId: enrollment.learnerId, attemptNo: 1, status, score, feedback: status === "GRADED" ? (score >= 8 ? "Nắm chắc kiến thức và trình bày tốt." : "Cần xem lại các nội dung trọng tâm.") : null, startedAt: addDays(-3, 1 + learnerIndex % 8), submittedAt: status === "IN_PROGRESS" ? null : addDays(-3, 2 + learnerIndex % 8), gradePublishedAt: status === "GRADED" ? addDays(-2) : null });
      if (status !== "IN_PROGRESS") for (const [answerIndex, examQuestion] of assignedQuestions.entries()) answers.push({ attemptId: id, questionId: examQuestion.questionId, answerData: { selected: answerIndex < (score ?? 6) ? "Phương án B" : "Phương án A" }, score: answerIndex < (score ?? 6) ? 1 : 0 });
      if (status === "GRADED") gradeHistory.push({ id: `${id}-grade-1`, attemptId: id, graderId: instructorIds[classInfo.index % instructorIds.length], previousScore: null, nextScore: score, reason: "Chấm điểm dữ liệu thử nghiệm theo đáp án và rubric.", createdAt: addDays(-2) });
    }
  }
  await createMany(prisma.examAttempt, attempts);
  await createMany(prisma.attemptAnswer, answers);
  await createMany(prisma.gradeHistory, gradeHistory);

  const assignments = [];
  const submissions = [];
  const announcements = [];
  for (const classInfo of classes) {
    const classEnrollments = enrollments.filter((item) => item.classId === classInfo.id && item.status !== "PENDING").slice(0, 20);
    for (let index = 0; index < 3; index += 1) {
      const assignmentId = `demo-assignment-${pad(classInfo.index + 1)}-${index + 1}`;
      const status = index === 2 && classInfo.status === "DRAFT" ? "DRAFT" : index === 0 ? "CLOSED" : "PUBLISHED";
      assignments.push({ id: assignmentId, classId: classInfo.id, createdById: instructorIds[classInfo.index % instructorIds.length], title: `${["Bài thực hành", "Bài tập nhóm", "Đồ án ngắn"][index]} ${index + 1} — ${classInfo.code}`, description: "Áp dụng kiến thức của lớp vào một tình huống nghiệp vụ cụ thể.", instructions: "Nộp phần phân tích, sản phẩm thực hiện và phần tự đánh giá theo rubric.", dueAt: addDays(index * 14 - 10, 16), maxScore: 10, rubric: [{ criterion: "Đúng yêu cầu", weight: 40 }, { criterion: "Chất lượng giải pháp", weight: 40 }, { criterion: "Trình bày", weight: 20 }], status, createdAt: addDays(-25 + index) });
      if (status !== "DRAFT") for (const [learnerIndex, enrollment] of classEnrollments.entries()) {
        const graded = status === "CLOSED" || learnerIndex % 3 !== 0;
        submissions.push({ id: `${assignmentId}-submission-${pad(learnerIndex + 1, 3)}`, assignmentId, learnerId: enrollment.learnerId, content: `Bài làm thử nghiệm của học viên ${learnerIndex + 1} cho ${classInfo.code}.`, status: graded ? "GRADED" : "SUBMITTED", submittedAt: addDays(index * 7 - 12, 8 + learnerIndex % 8), score: graded ? 6 + (learnerIndex % 5) : null, rubricScores: graded ? { requirements: 3.2, solution: 3.5, presentation: 1.5 } : null, feedback: graded ? "Bài làm đạt yêu cầu; cần bổ sung dẫn chứng cho phần kết luận." : null, gradedBy: graded ? instructorIds[classInfo.index % instructorIds.length] : null, gradedAt: graded ? addDays(index * 7 - 10) : null });
      }
    }
    for (let index = 0; index < 3; index += 1) announcements.push({ id: `demo-announcement-${pad(classInfo.index + 1)}-${index + 1}`, classId: classInfo.id, authorId: instructorIds[classInfo.index % instructorIds.length], title: ["Kế hoạch học tập tuần mới", "Lưu ý về bài thực hành", "Lịch hỗ trợ và giải đáp"][index], body: `Thông báo dành cho lớp ${classInfo.code}. Học viên kiểm tra lịch, tài liệu và nhiệm vụ cần hoàn thành.`, publishedAt: addDays(-14 + index * 5) });
  }
  await createMany(prisma.assignment, assignments);
  await createMany(prisma.assignmentSubmission, submissions);
  await createMany(prisma.classAnnouncement, announcements);

  const topics = [];
  const posts = [];
  for (const classInfo of classes) {
    for (let index = 0; index < 4; index += 1) {
      const topicId = `demo-topic-${pad(classInfo.index + 1)}-${index + 1}`;
      topics.push({ id: topicId, classId: classInfo.id, authorId: index === 0 ? instructorIds[classInfo.index % instructorIds.length] : learnerIds[(classInfo.index * 5 + index) % learnerIds.length], title: ["Hỏi đáp nội dung tuần", "Chia sẻ tài nguyên học tập", "Thảo luận bài thực hành", "Góp ý hoạt động lớp"][index] + ` — ${classInfo.code}`, body: "Khu vực trao đổi có kiểm duyệt dành cho thành viên lớp học.", tags: ["thảo-luận", classInfo.code.toLowerCase()], isPinned: index === 0, isLocked: classInfo.status === "CLOSED" && index === 3, status: "PUBLISHED", createdAt: addDays(-20 + index * 3) });
      for (let postIndex = 0; postIndex < 6; postIndex += 1) posts.push({ id: `${topicId}-post-${postIndex + 1}`, topicId, authorId: postIndex === 0 ? instructorIds[classInfo.index % instructorIds.length] : learnerIds[(classInfo.index * 7 + index + postIndex) % learnerIds.length], body: postIndex === 0 ? "Mọi người trình bày câu hỏi kèm ngữ cảnh để nhận hỗ trợ chính xác." : `Ý kiến trao đổi số ${postIndex} cho chủ đề của lớp ${classInfo.code}.`, status: "PUBLISHED", createdAt: addDays(-19 + index * 3, postIndex) });
    }
  }
  await createMany(prisma.forumTopic, topics);
  await createMany(prisma.forumPost, posts);

  const sessions = [];
  const attendance = [];
  for (const classInfo of classes) {
    const classLearners = enrollments.filter((item) => item.classId === classInfo.id && item.status !== "PENDING").slice(0, 22);
    const schedule = [[-14, "COMPLETED"], [-7, "COMPLETED"], [3, "SCHEDULED"], [10, "SCHEDULED"], [17, "CANCELLED"]];
    for (const [sessionIndex, [dayOffset, status]] of schedule.entries()) {
      const id = `demo-session-${pad(classInfo.index + 1)}-${sessionIndex + 1}`;
      const startsAt = addDays(dayOffset, 2 + (classInfo.index % 6));
      sessions.push({ id, classId: classInfo.id, hostId: instructorIds[classInfo.index % instructorIds.length], title: `${["Khởi động chuyên đề", "Thực hành có hướng dẫn", "Giải đáp trực tuyến", "Chữa bài tập", "Buổi học thay đổi lịch"][sessionIndex]} — ${classInfo.code}`, startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), provider: sessionIndex % 2 === 0 ? "GOOGLE_MEET" : "JITSI", requestedProvider: sessionIndex % 2 === 0 ? "GOOGLE_MEET" : "JITSI", providerRef: `demo-${classInfo.code}-${sessionIndex + 1}`, hostUrl: `https://meet.google.com/demo-${classInfo.index + 1}-${sessionIndex + 1}-host`, attendeeUrl: `https://meet.google.com/demo-${classInfo.index + 1}-${sessionIndex + 1}`, status, cancellationReason: status === "CANCELLED" ? "Điều chỉnh kế hoạch đào tạo." : null, attendanceLockedAt: status === "COMPLETED" ? addDays(dayOffset, 5) : null, attendanceLockedById: status === "COMPLETED" ? instructorIds[classInfo.index % instructorIds.length] : null, recordingStatus: status === "COMPLETED" && sessionIndex === 0 ? "READY" : "NONE", recordingUrl: status === "COMPLETED" && sessionIndex === 0 ? `https://media.wind.edu.vn/recordings/${id}` : null, recordingReadyAt: status === "COMPLETED" && sessionIndex === 0 ? addDays(dayOffset, 6) : null });
      if (status === "COMPLETED") for (const [learnerIndex, enrollment] of classLearners.entries()) {
        const attendanceStatus = learnerIndex % 11 === 0 ? "ABSENT" : learnerIndex % 7 === 0 ? "LATE" : learnerIndex % 13 === 0 ? "EXCUSED" : "PRESENT";
        attendance.push({ sessionId: id, learnerId: enrollment.learnerId, joinedAt: attendanceStatus === "ABSENT" ? null : new Date(startsAt.getTime() + (attendanceStatus === "LATE" ? 18 : 2) * 60_000), leftAt: attendanceStatus === "ABSENT" ? null : new Date(startsAt.getTime() + (attendanceStatus === "LATE" ? 80 : 88) * 60_000), attendedMinutes: attendanceStatus === "ABSENT" ? 0 : attendanceStatus === "LATE" ? 62 : 86, status: attendanceStatus, providerParticipantId: `participant-${classInfo.index + 1}-${sessionIndex + 1}-${learnerIndex + 1}`, providerSnapshot: { source: "DEMO", synced: true } });
      }
    }
  }
  await createMany(prisma.liveSession, sessions);
  await createMany(prisma.attendanceRecord, attendance);

  const notifications = learnerIds.flatMap((learnerId, learnerIndex) => Array.from({ length: 4 }, (_, index) => ({ id: `demo-notification-${pad(learnerIndex + 1, 3)}-${index + 1}`, recipientId: learnerId, type: ["CLASS_REMINDER", "ASSIGNMENT", "GRADE", "ANNOUNCEMENT"][index], title: ["Lớp học sắp bắt đầu", "Có bài tập mới", "Điểm đã được công bố", "Thông báo mới từ giảng viên"][index], entityType: ["LIVE_SESSION", "ASSIGNMENT", "EXAM_ATTEMPT", "CLASS_ANNOUNCEMENT"][index], entityId: `demo-entity-${index + 1}`, dedupKey: `demo:${learnerId}:${index + 1}`, readAt: index < 2 ? addDays(-1) : null, createdAt: addDays(-4 + index) })));
  await createMany(prisma.notification, notifications);

  const tickets = Array.from({ length: 36 }, (_, index) => ({ id: `demo-ticket-${pad(index + 1, 3)}`, reporterId: learnerIds[index % learnerIds.length], assigneeId: index % 5 === 0 ? null : index % 2 === 0 ? manager.id : admin.id, category: ["Tài khoản", "Lớp học", "Bài kiểm tra", "Tài liệu", "Lớp trực tuyến", "Khác"][index % 6], severity: index % 17 === 0 ? "P0" : index % 7 === 0 ? "P1" : index % 3 === 0 ? "P2" : "P3", description: `Yêu cầu hỗ trợ thử nghiệm số ${index + 1}, có đủ ngữ cảnh để kiểm tra quy trình xử lý.`, contextId: classes[index % classes.length].id, status: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"][index % 4], resolution: index % 4 >= 2 ? "Đã hướng dẫn người dùng và xác nhận xử lý thành công." : null, dueAt: addDays(index % 4 - 1), createdAt: addDays(-20 + index % 18) }));
  await createMany(prisma.supportTicket, tickets);
  await createMany(prisma.ticketComment, tickets.flatMap((ticket, index) => Array.from({ length: 2 }, (_, commentIndex) => ({ id: `${ticket.id}-comment-${commentIndex + 1}`, ticketId: ticket.id, authorId: commentIndex === 0 ? ticket.reporterId : ticket.assigneeId ?? manager.id, body: commentIndex === 0 ? "Tôi gửi thêm thông tin để trung tâm kiểm tra." : "Trung tâm đã tiếp nhận và đang xử lý theo mức độ ưu tiên.", createdAt: addDays(-19 + index % 18, commentIndex + 1) }))));

  const auditExists = await prisma.auditLog.findFirst({ where: { action: "DEMO_DATASET_SEEDED", entityType: "platform", entityId: "wind-edu-large" } });
  if (!auditExists) await prisma.auditLog.create({ data: { actorId: admin.id, action: "DEMO_DATASET_SEEDED", entityType: "platform", entityId: "wind-edu-large", context: { instructors: instructorIds.length, learners: learnerIds.length, courses: courses.length, classes: classes.length, materials: materials.length, questions: questions.length, exams: exams.length, assignments: assignments.length, sessions: sessions.length, tickets: tickets.length } } });

  return {
    users: instructorIds.length + learnerIds.length,
    courses: courses.length,
    classes: classes.length,
    enrollments: enrollments.length,
    materials: materials.length,
    questions: questions.length,
    exams: exams.length,
    attempts: attempts.length,
    assignments: assignments.length,
    submissions: submissions.length,
    forumTopics: topics.length,
    forumPosts: posts.length,
    liveSessions: sessions.length,
    attendanceRecords: attendance.length,
    notifications: notifications.length,
    supportTickets: tickets.length,
  };
}
