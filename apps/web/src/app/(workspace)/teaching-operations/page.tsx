"use client";

import { CheckCircle2, ClipboardCheck, Link2, Save, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { ExamAttempt, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function TeachingOperationsPage() {
  const { session, notify } = useApp();
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [grading, setGrading] = useState<ExamAttempt | null>(null);
  const [grade, setGrade] = useState({ score: 0, feedback: "", correctionReason: "" });
  const [attendance, setAttendance] = useState({
    sessionId: "",
    learnerId: "usr-learner",
    status: "PRESENT",
    attendedMinutes: 60,
    adjustmentReason: "Xác nhận theo nhật ký phòng học",
  });
  const [recording, setRecording] = useState({
    sessionId: "",
    recordingUrl: "",
  });
  const load = useCallback(async () => {
    if (session.roleCode !== "INSTRUCTOR") return;
    try {
      const [attemptData, sessionData] = await Promise.all([
        apiRequest<ExamAttempt[]>("/instructor/exam-attempts", {
          roleCode: session.roleCode,
        }),
        apiRequest<LiveSession[]>("/sessions", { roleCode: session.roleCode }),
      ]);
      setAttempts(attemptData);
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
  }, [notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const saveGrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grading) return;
    try {
      await apiRequest(`/instructor/exam-attempts/${grading.id}/grade`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify(grade),
      });
      notify("Đã lưu điểm và phản hồi.");
      setGrading(null);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm.",
        "error",
      );
    }
  };
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
  const markRecordingReady = async () => {
    if (!recording.sessionId) return;
    try {
      await apiRequest(`/instructor/sessions/${recording.sessionId}/recordings/status`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ status: "READY", retentionDays: 90 }),
      });
      notify("Bản ghi đã sẵn sàng và được phát hành trong 90 ngày.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không phát hành được bản ghi.", "error");
    }
  };
  if (session.roleCode !== "INSTRUCTOR") return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Instructor Workspace"
        title="Nghiệp vụ giảng dạy"
        description="Chấm bài, điều chỉnh điểm danh và phát hành bản ghi sau buổi học."
      />
      <div className="grid gap-7 xl:grid-cols-[1.1fr_.9fr]">
        <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Bài làm & chấm điểm
            </h2>
          </div>
          <div className="mt-5 space-y-3">
            {attempts.length ? (
              attempts.map((item) => (
                <div
                  className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
                  key={item.id}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-extrabold">{item.learnerId}</p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {Object.keys(item.answers).length} câu đã trả lời · Điểm{" "}
                      {item.score ?? "chưa có"}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setGrading(item);
                      setGrade({
                        score: item.score ?? 0,
                        feedback: item.feedback ?? "",
                        correctionReason: "",
                      });
                    }}
                    variant="secondary"
                  >
                    Chấm bài
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-12 text-center text-sm text-slate-400">
                Chưa có lượt làm bài cần chấm.
              </p>
            )}
          </div>
        </section>
        <div className="space-y-7">
          <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
            <div className="flex items-center gap-3">
              <UserCheck className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Điều chỉnh điểm danh
              </h2>
            </div>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => void saveAttendance(e)}
            >
              <Field label="Buổi học">
                <select
                  className={inputClass}
                  required
                  value={attendance.sessionId}
                  onChange={(e) =>
                    setAttendance({ ...attendance, sessionId: e.target.value })
                  }
                >
                  {sessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mã học viên">
                  <input
                    className={inputClass}
                    required
                    value={attendance.learnerId}
                    onChange={(e) =>
                      setAttendance({
                        ...attendance,
                        learnerId: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Trạng thái">
                  <select
                    className={inputClass}
                    value={attendance.status}
                    onChange={(e) =>
                      setAttendance({ ...attendance, status: e.target.value })
                    }
                  >
                    <option value="PRESENT">Có mặt</option>
                    <option value="LATE">Đi muộn</option>
                    <option value="ABSENT">Vắng</option>
                    <option value="EXCUSED">Có phép</option>
                  </select>
                </Field>
              </div>
              <Field label="Số phút tham dự">
                <input
                  className={inputClass}
                  min={0}
                  type="number"
                  value={attendance.attendedMinutes}
                  onChange={(e) =>
                    setAttendance({
                      ...attendance,
                      attendedMinutes: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Lý do điều chỉnh">
                <input
                  className={inputClass}
                  minLength={3}
                  required
                  value={attendance.adjustmentReason}
                  onChange={(e) =>
                    setAttendance({
                      ...attendance,
                      adjustmentReason: e.target.value,
                    })
                  }
                />
              </Field>
              <Button type="submit">
                <Save size={16} />
                Lưu điểm danh
              </Button>
            </form>
          </section>
          <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
            <div className="flex items-center gap-3">
              <Link2 className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Bản ghi buổi học
              </h2>
            </div>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => void attachRecording(e)}
            >
              <Field label="Buổi đã kết thúc">
                <select
                  className={inputClass}
                  required
                  value={recording.sessionId}
                  onChange={(e) =>
                    setRecording({ ...recording, sessionId: e.target.value })
                  }
                >
                  <option value="">Chọn buổi học</option>
                  {sessions
                    .filter((item) => item.status === "COMPLETED")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="URL bản ghi">
                <input
                  className={inputClass}
                  required
                  type="url"
                  value={recording.recordingUrl}
                  onChange={(e) =>
                    setRecording({ ...recording, recordingUrl: e.target.value })
                  }
                />
              </Field>
              <Button type="submit">Gắn bản ghi</Button>
            </form>
            {sessions.find((item) => item.id === recording.sessionId)?.recordingStatus === "PROCESSING" ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">Bản ghi đang xử lý và chưa hiển thị cho học viên.</p>
                <Button className="mt-3" onClick={() => void markRecordingReady()} variant="secondary">
                  <CheckCircle2 size={16} /> Xác nhận sẵn sàng
                </Button>
              </div>
            ) : null}
            {sessions.find((item) => item.id === recording.sessionId)?.recordingStatus === "READY" ? (
              <p className="mt-4 text-sm font-bold text-emerald-700">
                Bản ghi sẵn sàng đến {new Date(sessions.find((item) => item.id === recording.sessionId)?.recordingExpiresAt ?? "").toLocaleDateString("vi-VN")}.
              </p>
            ) : null}
          </section>
        </div>
      </div>
      <Modal
        open={Boolean(grading)}
        onClose={() => setGrading(null)}
        title="Chấm bài và phản hồi"
      >
        <form className="space-y-4" onSubmit={(e) => void saveGrade(e)}>
          <Field label="Điểm">
            <input
              className={inputClass}
              min={0}
              step="0.25"
              type="number"
              value={grade.score}
              onChange={(e) =>
                setGrade({ ...grade, score: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Phản hồi">
            <textarea
              className={inputClass}
              minLength={3}
              required
              rows={4}
              value={grade.feedback}
              onChange={(e) => setGrade({ ...grade, feedback: e.target.value })}
            />
          </Field>
          {grading?.status === "GRADED" ? <Field label="Lý do sửa điểm"><textarea className={inputClass} minLength={5} required rows={3} value={grade.correctionReason} onChange={(event) => setGrade({ ...grade, correctionReason: event.target.value })} /></Field> : null}
          <Button type="submit">Lưu kết quả</Button>
        </form>
      </Modal>
    </div>
  );
}
