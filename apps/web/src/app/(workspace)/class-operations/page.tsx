"use client";

import { CheckCheck, RotateCcw, UserPlus, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { Exam, LearningClass, Material } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type ReviewDecision = "APPROVE" | "RETURN";

export default function ClassOperationsPage() {
  const { session, notify } = useApp();
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [member, setMember] = useState({ classId: "", instructorId: "", learnerId: "" });
  const [reviewingExam, setReviewingExam] = useState<Exam | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("APPROVE");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    if (session.roleCode !== "CENTER_MANAGER") return;
    try {
      const [classData, materialData, examData] = await Promise.all([
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        apiRequest<Material[]>("/materials", { roleCode: session.roleCode }),
        apiRequest<Exam[]>("/exams", { roleCode: session.roleCode }),
      ]);
      setClasses(classData);
      setMaterials(materialData);
      setExams(examData);
      setMember((current) => ({ ...current, classId: current.classId || classData[0]?.id || "" }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được dữ liệu điều hành.", "error");
    }
  }, [notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const assign = async (kind: "instructors" | "enrollments") => {
    const userId = kind === "instructors" ? member.instructorId : member.learnerId;
    if (!member.classId || !userId.trim()) return;
    try {
      await apiRequest(`/manager/classes/${member.classId}/${kind}`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId: userId.trim() }),
      });
      notify(kind === "instructors" ? "Đã phân công giảng viên." : "Đã ghi danh học viên.");
      setMember({ ...member, [kind === "instructors" ? "instructorId" : "learnerId"]: "" });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được thành viên.", "error");
    }
  };

  const reviewMaterial = async (item: Material) => {
    try {
      await apiRequest(`/manager/materials/${item.id}/review`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ action: "APPROVE" }),
      });
      notify("Đã duyệt học liệu.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không duyệt được học liệu.", "error");
    }
  };

  const openExamReview = (item: Exam) => {
    setReviewingExam(item);
    setDecision("APPROVE");
    setReviewNote("");
  };

  const submitExamReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewingExam) return;
    if (decision === "RETURN" && reviewNote.trim().length < 3) {
      notify("Lý do trả đề phải có ít nhất 3 ký tự.", "error");
      return;
    }
    setReviewing(true);
    try {
      await apiRequest(`/manager/exams/${reviewingExam.id}/approve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ decision, reviewNote: reviewNote.trim() || undefined }),
      });
      notify(decision === "APPROVE" ? "Đã phê duyệt và khóa phiên bản đề thi." : "Đã trả đề cho giảng viên chỉnh sửa.");
      setReviewingExam(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được kết quả duyệt đề.", "error");
    } finally {
      setReviewing(false);
    }
  };

  if (session.roleCode !== "CENTER_MANAGER") return <AccessDenied />;
  const pendingExams = exams.filter((item) => item.status === "PENDING_REVIEW");

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow="Center Management" title="Điều hành lớp học" description="Phân công, ghi danh, duyệt học liệu và phê duyệt đề thi theo đúng vai trò." />

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <UsersRound className="text-sky-700" />
          <h2 className="font-heading text-xl font-extrabold">Thành viên lớp</h2>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Field label="Lớp học">
            <select className={inputClass} value={member.classId} onChange={(event) => setMember({ ...member, classId: event.target.value })}>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Mã giảng viên"><input className={inputClass} placeholder="usr-instructor" value={member.instructorId} onChange={(event) => setMember({ ...member, instructorId: event.target.value })} /></Field>
            <Button aria-label="Phân công giảng viên" onClick={() => void assign("instructors")}><UserPlus size={16} /></Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Mã học viên"><input className={inputClass} placeholder="usr-learner" value={member.learnerId} onChange={(event) => setMember({ ...member, learnerId: event.target.value })} /></Field>
            <Button aria-label="Ghi danh học viên" onClick={() => void assign("enrollments")}><UserPlus size={16} /></Button>
          </div>
        </div>
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {classes.map((item) => (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4" key={item.id}>
              <div>
                <p className="text-sm font-extrabold">{item.code} · {item.name}</p>
                <p className="mt-1 text-xs text-slate-500">{item.instructorIds.length} giảng viên · {item.learnerIds.length}/{item.capacity} học viên</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      </section>

      <div className="mt-7 grid gap-7 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-heading text-xl font-extrabold">Học liệu chờ duyệt</h2>
          <div className="mt-4 space-y-3">
            {materials.some((item) => item.visibility === "DRAFT") ? materials.filter((item) => item.visibility === "DRAFT").map((item) => (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4" key={item.id}>
                <div><p className="text-sm font-bold">{item.name}</p><p className="text-xs text-slate-500">{item.folder} · v{item.version}</p></div>
                <Button onClick={() => void reviewMaterial(item)} variant="secondary"><CheckCheck size={15} />Duyệt</Button>
              </div>
            )) : <p className="py-8 text-center text-sm text-slate-400">Không có học liệu chờ duyệt.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-heading text-xl font-extrabold">Đề thi chờ phê duyệt</h2>
          <div className="mt-4 space-y-3">
            {pendingExams.length ? pendingExams.map((item) => (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4" key={item.id}>
                <div><p className="text-sm font-bold">{item.title}</p><p className="text-xs text-slate-500">Phiên bản {item.version} · {item.questionIds.length} câu · {item.totalScore} điểm</p></div>
                <Button onClick={() => openExamReview(item)} variant="secondary"><CheckCheck size={15} />Xem xét</Button>
              </div>
            )) : <p className="py-8 text-center text-sm text-slate-400">Không có đề thi chờ phê duyệt.</p>}
          </div>
        </section>
      </div>

      <Modal open={Boolean(reviewingExam)} onClose={() => setReviewingExam(null)} title="Phê duyệt đề thi" description={reviewingExam ? `${reviewingExam.title} · phiên bản ${reviewingExam.version}` : undefined}>
        <form className="space-y-4" onSubmit={(event) => void submitExamReview(event)}>
          <Field label="Quyết định">
            <select className={inputClass} value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
              <option value="APPROVE">Phê duyệt và xuất bản</option>
              <option value="RETURN">Trả về để chỉnh sửa</option>
            </select>
          </Field>
          <Field label={decision === "RETURN" ? "Lý do trả đề — bắt buộc" : "Ghi chú duyệt — không bắt buộc"}>
            <textarea className={inputClass} minLength={decision === "RETURN" ? 3 : undefined} required={decision === "RETURN"} rows={4} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
          </Field>
          <Button loading={reviewing} type="submit" variant={decision === "RETURN" ? "danger" : "primary"}>
            {decision === "RETURN" ? <RotateCcw size={16} /> : <CheckCheck size={16} />}{decision === "RETURN" ? "Trả đề" : "Phê duyệt"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
