"use client";
import { usePagination } from "@/shared/ui/ui";
import { hasEveryPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import type {
  DirectoryUser,
  Exam,
  ExamAttempt,
  ExamAttemptReview,
  GradingQueueGroup,
  LearningClass,
  LiveSession,
  RegradeRequest,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình chấm thi; giữ nguyên thứ tự hook. */
export function useTeachingModel() {
  const { session, notify } = useApp();

  const canManageTeaching =
    session.roleCode === "INSTRUCTOR" &&
    hasEveryPermission(session, [
      "question:manage",
      "exam:manage",
      "session:manage",
    ]);

  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [instructorClasses, setInstructorClasses] = useState<LearningClass[]>([]);

  // Bộ lọc chuẩn K-12 dành cho giáo viên: Khối -> Môn -> Lớp
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [classFilter, setClassFilter] = useState<string>("");

  const [gradingQueue, setGradingQueue] = useState<GradingQueueGroup[]>([]);

  const [regrades, setRegrades] = useState<RegradeRequest[]>([]);

  const [exams, setExams] = useState<Exam[]>([]);

  const [selectedExamId, setSelectedExamId] = useState("");

  const gradingExams = useMemo(
    () =>
      exams.filter((exam) =>
        attempts.some((attempt) => attempt.examId === exam.id),
      ),
    [attempts, exams],
  );

  const selectedAttempts = useMemo(
    () => attempts.filter((item) => item.examId === selectedExamId),
    [attempts, selectedExamId],
  );

  // Danh sách các môn học có trong các lớp giảng dạy của giáo viên
  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    instructorClasses.forEach((c) => {
      if (!gradeFilter || String(c.grade) === gradeFilter) {
        if (c.subject) set.add(c.subject);
      }
    });
    return Array.from(set);
  }, [instructorClasses, gradeFilter]);

  // Hàng đợi chấm bài đã áp dụng bộ lọc Khối -> Môn -> Lớp
  const filteredGradingQueue = useMemo(() => {
    return gradingQueue.filter((item) => {
      const cls = instructorClasses.find(
        (c) => c.code === item.classCode || c.id === item.classId,
      );
      const itemGrade = item.grade ?? cls?.grade;
      const itemSubject = item.subject ?? cls?.subject;

      if (
        gradeFilter &&
        itemGrade !== undefined &&
        itemGrade !== null &&
        String(itemGrade) !== gradeFilter
      ) {
        return false;
      }
      if (subjectFilter && itemSubject && itemSubject !== subjectFilter) {
        return false;
      }
      if (classFilter && item.classCode !== classFilter) {
        return false;
      }
      return true;
    });
  }, [gradingQueue, instructorClasses, gradeFilter, subjectFilter, classFilter]);

  const queueByClass = useMemo(
    () =>
      filteredGradingQueue.reduce<Record<string, GradingQueueGroup[]>>(
        (groups, item) => {
          (groups[item.classCode] ??= []).push(item);
          return groups;
        },
        {},
      ),
    [filteredGradingQueue],
  );

  const attemptPagination = usePagination(selectedAttempts);

  const [sessions, setSessions] = useState<LiveSession[]>([]);

  const [learners, setLearners] = useState<DirectoryUser[]>([]);

  const [learnersSessionId, setLearnersSessionId] = useState("");

  const [grading, setGrading] = useState<ExamAttempt | null>(null);

  const [activeRegrade, setActiveRegrade] = useState<RegradeRequest | null>(
    null,
  );

  const [regradeResolution, setRegradeResolution] = useState("");

  const [review, setReview] = useState<ExamAttemptReview | null>(null);

  const [reviewLoading, setReviewLoading] = useState(false);

  const [gradeSaving, setGradeSaving] = useState(false);

  const [questionScores, setQuestionScores] = useState<Record<string, number>>(
    {},
  );

  const [grade, setGrade] = useState({
    score: 0,
    feedback: "",
    correctionReason: "",
  });

  const [attendance, setAttendance] = useState({
    sessionId: "",
    learnerId: "",
    status: "PRESENT",
    attendedMinutes: 60,
    adjustmentReason: "Xác nhận theo nhật ký phòng học",
  });

  const [recording, setRecording] = useState({
    sessionId: "",
    recordingUrl: "",
  });

  /** Nạp lớp, bài nộp và buổi học thuộc phạm vi giảng viên hiện tại. */
  const load = useCallback(async () => {
    if (!canManageTeaching) return;
    try {
      const [
        attemptData,
        examData,
        sessionData,
        regradeData,
        queueData,
        classData,
      ] = await Promise.all([
        apiRequest<ExamAttempt[]>("/instructor/exam-attempts", {
          roleCode: session.roleCode,
        }),
        apiRequest<Exam[]>("/exams", { roleCode: session.roleCode }),
        apiRequest<LiveSession[]>("/sessions", {
          roleCode: session.roleCode,
        }),
        apiRequest<RegradeRequest[]>("/instructor/regrade-requests", {
          roleCode: session.roleCode,
        }),
        apiRequest<GradingQueueGroup[]>("/instructor/grading-queue", {
          roleCode: session.roleCode,
        }),
        apiRequest<LearningClass[]>("/instructor/classes", {
          roleCode: session.roleCode,
        }).catch(() => [] as LearningClass[]),
      ]);
      setAttempts(attemptData);
      setInstructorClasses(classData);
      setRegrades(
        regradeData.filter(
          (item) => item.status === "OPEN" || item.status === "IN_REVIEW",
        ),
      );
      setExams(examData);
      setGradingQueue(queueData);
      setSelectedExamId(
        (current) => current || attemptData[0]?.examId || examData[0]?.id || "",
      );
      setSessions(sessionData);
      setAttendance((current) => ({
        ...current,
        sessionId: current.sessionId || sessionData[0]?.id || "",
      }));
      setRecording((current) => ({
        ...current,
        sessionId:
          current.sessionId ||
          sessionData.find((item) => item.status === "COMPLETED")?.id ||
          "",
      }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được nghiệp vụ giảng dạy.",
        "error",
      );
    }
  }, [canManageTeaching, notify, session.roleCode]);

  /** Chọn buổi học và nạp bảng điểm danh chi tiết để chỉnh sửa. */
  const selectAttendanceSession = useCallback(
    async (sessionId: string) => {
      setAttendance((current) => ({ ...current, sessionId, learnerId: "" }));
      const classId = sessions.find((item) => item.id === sessionId)?.classId;
      if (!classId) {
        setLearners([]);
        setLearnersSessionId(sessionId);
        return;
      }
      try {
        setLearners(
          await apiRequest<DirectoryUser[]>(
            `/instructor/classes/${classId}/learners`,
            { roleCode: session.roleCode },
          ),
        );
        setLearnersSessionId(sessionId);
      } catch (error) {
        setLearners([]);
        setLearnersSessionId(sessionId);
        notify(
          error instanceof Error
            ? error.message
            : "Không tải được học viên của lớp.",
          "error",
        );
      }
    },
    [notify, session.roleCode, sessions],
  );

  useEffect(() => {
    if (
      !attendance.sessionId ||
      !sessions.length ||
      learnersSessionId === attendance.sessionId
    )
      return;
    const timer = window.setTimeout(
      () => void selectAttendanceSession(attendance.sessionId),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [
    attendance.sessionId,
    learnersSessionId,
    selectAttendanceSession,
    sessions.length,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Mở toàn bộ đề và đáp án của một lượt thi trước khi cho điểm. */
  const openGrade = async (
    item: ExamAttempt,
    regrade: RegradeRequest | null = null,
  ) => {
    setGrading(item);
    setActiveRegrade(regrade);
    setRegradeResolution("");
    setReview(null);
    setReviewLoading(true);
    try {
      const detail = await apiRequest<ExamAttemptReview>(
        `/instructor/exam-attempts/${item.id}/review`,
        { roleCode: session.roleCode },
      );
      setReview(detail);
      setQuestionScores(
        Object.fromEntries(
          detail.questions
            .filter((question) => question.requiresManualGrade)
            .map((question) => [question.questionId, question.awardedScore]),
        ),
      );
      setGrade({
        score: detail.attempt.score ?? 0,
        feedback: detail.attempt.feedback ?? "",
        correctionReason: "",
      });
    } catch (error) {
      setGrading(null);
      notify(
        error instanceof Error ? error.message : "Không mở được bài làm.",
        "error",
      );
    } finally {
      setReviewLoading(false);
    }
  };

  /** Nhận yêu cầu phúc khảo rồi mở đúng bài làm để người chấm ra quyết định. */
  const openRegrade = async (request: RegradeRequest) => {
    try {
      const claimed =
        request.status === "OPEN"
          ? await apiRequest<RegradeRequest>(
              `/instructor/regrade-requests/${request.id}/claim`,
              { method: "POST", roleCode: session.roleCode },
            )
          : request;
      if (claimed.assignedToId && claimed.assignedToId !== session.user.id) {
        notify("Yêu cầu này đang được giảng viên khác xử lý.", "error");
        await load();
        return;
      }
      const item = attempts.find((attempt) => attempt.id === request.attemptId);
      if (!item) {
        notify("Không tìm thấy bài làm thuộc yêu cầu phúc khảo.", "error");
        return;
      }
      await openGrade(item, claimed);
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không nhận được yêu cầu phúc khảo.",
        "error",
      );
    }
  };

  /** Lưu điểm từng câu tự luận, tổng điểm và phản hồi cho bài làm đang mở. */
  const saveGrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grading || !review) return;
    const manualScores = review.questions
      .filter((question) => question.requiresManualGrade)
      .map((question) => ({
        questionId: question.questionId,
        score: questionScores[question.questionId] ?? 0,
      }));
    const objectiveScore = review.questions
      .filter((question) => !question.requiresManualGrade)
      .reduce((total, question) => total + question.awardedScore, 0);
    const totalScore =
      objectiveScore +
      manualScores.reduce((total, item) => total + item.score, 0);
    setGradeSaving(true);
    try {
      if (activeRegrade) {
        await apiRequest(
          `/instructor/regrade-requests/${activeRegrade.id}/resolve`,
          {
            method: "PATCH",
            roleCode: session.roleCode,
            body: JSON.stringify({
              decision: "APPROVE",
              resolution: regradeResolution,
              score: totalScore,
              feedback: grade.feedback,
              questionScores: manualScores,
            }),
          },
        );
        notify(
          "Đã chấp nhận phúc khảo, công bố điểm mới và thông báo học viên.",
        );
      } else {
        await apiRequest(`/instructor/exam-attempts/${grading.id}/grade`, {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            ...grade,
            score: totalScore,
            questionScores: manualScores,
          }),
        });
        notify("Đã lưu điểm và phản hồi.");
      }
      setGrading(null);
      setActiveRegrade(null);
      setReview(null);
      setQuestionScores({});
      setRegradeResolution("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm.",
        "error",
      );
    } finally {
      setGradeSaving(false);
    }
  };

  /** Từ chối phúc khảo, giữ nguyên điểm hiện tại và gửi lý do cho học viên. */
  const rejectRegrade = async () => {
    if (!activeRegrade || regradeResolution.trim().length < 5) return;
    setGradeSaving(true);
    try {
      await apiRequest(
        `/instructor/regrade-requests/${activeRegrade.id}/resolve`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            decision: "REJECT",
            resolution: regradeResolution,
          }),
        },
      );
      notify("Đã từ chối phúc khảo và thông báo lý do cho học viên.");
      setGrading(null);
      setActiveRegrade(null);
      setReview(null);
      setRegradeResolution("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không kết thúc được yêu cầu phúc khảo.",
        "error",
      );
    } finally {
      setGradeSaving(false);
    }
  };

  /** Gửi các thay đổi điểm danh thủ công cùng lý do điều chỉnh. */
  const saveAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(
        `/instructor/sessions/${attendance.sessionId}/attendance`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            learnerId: attendance.learnerId,
            status: attendance.status,
            attendedMinutes: attendance.attendedMinutes,
            adjustmentReason: attendance.adjustmentReason,
          }),
        },
      );
      notify("Đã cập nhật điểm danh và lý do điều chỉnh.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm danh.",
        "error",
      );
    }
  };

  /** Gắn đường dẫn bản ghi với buổi học đã kết thúc để đưa vào xử lý. */
  const attachRecording = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(
        `/instructor/sessions/${recording.sessionId}/recordings`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ recordingUrl: recording.recordingUrl }),
        },
      );
      notify("Đã tiếp nhận bản ghi và chuyển sang trạng thái đang xử lý.");
      setRecording({ ...recording, recordingUrl: "" });
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gắn được bản ghi.",
        "error",
      );
    }
  };

  /** Xác nhận bản ghi đã sẵn sàng cho người có quyền xem. */
  const markRecordingReady = async () => {
    if (!recording.sessionId) return;
    try {
      await apiRequest(
        `/instructor/sessions/${recording.sessionId}/recordings/status`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({ status: "READY", retentionDays: 90 }),
        },
      );
      notify("Bản ghi đã sẵn sàng và được phát hành trong 90 ngày.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không phát hành được bản ghi.",
        "error",
      );
    }
  };

  const objectiveScore =
    review?.questions
      .filter((question) => !question.requiresManualGrade)
      .reduce((total, question) => total + question.awardedScore, 0) ?? 0;

  const manualScore =
    review?.questions
      .filter((question) => question.requiresManualGrade)
      .reduce(
        (total, question) => total + (questionScores[question.questionId] ?? 0),
        0,
      ) ?? 0;
  return {
    session,
    canManageTeaching,
    attempts,
    gradingQueue,
    filteredGradingQueue,
    instructorClasses,
    gradeFilter,
    setGradeFilter,
    subjectFilter,
    setSubjectFilter,
    classFilter,
    setClassFilter,
    availableSubjects,
    regrades,
    exams,
    selectedExamId,
    setSelectedExamId,
    gradingExams,
    selectedAttempts,
    queueByClass,
    attemptPagination,
    sessions,
    learners,
    grading,
    setGrading,
    activeRegrade,
    setActiveRegrade,
    regradeResolution,
    setRegradeResolution,
    review,
    setReview,
    reviewLoading,
    gradeSaving,
    questionScores,
    setQuestionScores,
    grade,
    setGrade,
    attendance,
    setAttendance,
    recording,
    setRecording,
    selectAttendanceSession,
    openGrade,
    openRegrade,
    saveGrade,
    rejectRegrade,
    saveAttendance,
    attachRecording,
    markRecordingReady,
    objectiveScore,
    manualScore,
  };
}
