"use client";

import { CheckCheck, Eye, History, RotateCcw, Trash2, Undo2, Upload, UserPlus, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Tabs } from "@/components/ui";
import { UserPicker } from "@/components/user-picker";
import { apiRequest, previewApiFile } from "@/lib/api-client";
import { MaterialSearchControls, useMaterialSearch } from "@/components/material-search";
import { hasPermission } from "@/lib/access-control";
import type { ClassRoster, EnrollmentImportResult, Exam, InstructorRole, LearningClass, Material } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type ReviewDecision = "APPROVE" | "RETURN";

/** Tập trung thao tác nhân sự lớp, ghi danh và duyệt nội dung/đề thi. */
export default function ClassOperationsPage() {
  const { session, notify } = useApp();
  const canManage = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [member, setMember] = useState({ classId: "", instructorId: "", instructorRole: "PRIMARY" as InstructorRole, learnerId: "" });
  const [roster, setRoster] = useState<ClassRoster | null>(null);
  const [bulkLearners, setBulkLearners] = useState("");
  const [importResults, setImportResults] = useState<EnrollmentImportResult[]>([]);
  const [reviewingExam, setReviewingExam] = useState<Exam | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("APPROVE");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [activeTab, setActiveTab] = useState<"members" | "materials" | "exams">("members");

  const materialSearch = useMaterialSearch(session.roleCode, { visibility: "DRAFT" }, canManage, session.user.id);
  const materials = materialSearch.items;
  const refreshMaterials = materialSearch.refresh;

  /** Nạp song song lớp, người dùng và các hàng đợi duyệt theo quyền hiện tại. */
  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const [classData, examData] = await Promise.all([
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        apiRequest<Exam[]>("/exams", { roleCode: session.roleCode }),
      ]);
      setClasses(classData);
      refreshMaterials();
      setExams(examData);
      setMember((current) => ({ ...current, classId: current.classId || classData[0]?.id || "" }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được dữ liệu điều hành.", "error");
    }
  }, [canManage, notify, refreshMaterials, session.roleCode]);

  /** Nạp giảng viên và học viên của lớp để hiển thị, phân công hoặc gỡ thành viên. */
  const loadRoster = useCallback(async (classId: string) => {
    if (!classId || !canManage) return;
    try { setRoster(await apiRequest<ClassRoster>(`/manager/classes/${classId}/roster`, { roleCode: session.roleCode })); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được danh sách lớp.", "error"); }
  }, [canManage, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => { const timer = window.setTimeout(() => void loadRoster(member.classId), 0); return () => window.clearTimeout(timer); }, [loadRoster, member.classId]);

  /** Gọi đúng endpoint để phân công giảng viên hoặc ghi danh học viên đã chọn. */
  const assign = async (kind: "instructors" | "enrollments") => {
    const userId = kind === "instructors" ? member.instructorId : member.learnerId;
    if (!member.classId || !userId.trim()) return;
    try {
      await apiRequest(`/manager/classes/${member.classId}/${kind}`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(kind === "instructors" ? { userId: userId.trim(), role: member.instructorRole } : { userId: userId.trim() }),
      });
      notify(kind === "instructors" ? "Đã phân công giảng viên." : "Đã ghi danh học viên.");
      setMember({ ...member, [kind === "instructors" ? "instructorId" : "learnerId"]: "" });
      await load();
      await loadRoster(member.classId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được thành viên.", "error");
    }
  };

  /** Ghi danh hàng loạt từ danh sách tài khoản nhập vào và hiển thị kết quả từng dòng. */
  const importEnrollments = async () => {
    const userIds = bulkLearners.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
    if (!member.classId || !userIds.length) return;
    try { const results = await apiRequest<EnrollmentImportResult[]>(`/manager/classes/${member.classId}/enrollments/import`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ userIds }) }); setImportResults(results); setBulkLearners(""); await Promise.all([load(), loadRoster(member.classId)]); notify(`Đã xử lý ${results.length} dòng ghi danh.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Không nhập được danh sách.", "error"); }
  };

  /** Gỡ thành viên khỏi đúng nhóm nhân sự của lớp rồi tải lại roster. */
  const removeMember = async (kind: "instructors" | "enrollments", userId: string) => {
    const reason = window.prompt(kind === "instructors" ? "Lý do gỡ phân công giảng viên" : "Lý do gỡ học viên khỏi lớp");
    if (!reason) return;
    try { await apiRequest(`/manager/classes/${member.classId}/${kind}/${userId}/remove`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ reason }) }); await Promise.all([load(), loadRoster(member.classId)]); notify("Đã cập nhật thành viên và lưu lịch sử."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không gỡ được thành viên.", "error"); }
  };

  /** Duyệt học liệu đang chờ, hoặc thu hồi kèm lý do để giảng viên sửa hay xóa. */
  const reviewMaterial = async (item: Material, action: "APPROVE" | "REVOKE") => {
    const reason = action === "REVOKE" ? window.prompt("Lý do thu hồi học liệu") : undefined;
    if (action === "REVOKE" && !reason) return;
    try {
      await apiRequest(`/manager/materials/${item.id}/review`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ action, reason }),
      });
      notify(action === "APPROVE" ? "Đã duyệt học liệu." : "Đã thu hồi học liệu và thông báo người đăng.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kiểm duyệt được học liệu.", "error");
    }
  };

  /** Mở bản xem trước để quản lý đọc nội dung trước khi quyết định. */
  const previewMaterial = async (item: Material) => {
    try {
      const access = await apiRequest<{ url: string }>(`/materials/${item.id}/access?action=PREVIEW`, { roleCode: session.roleCode });
      await previewApiFile(access.url, session.roleCode, item.name);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không mở được bản xem trước.", "error");
    }
  };

  /** Mở hộp thoại duyệt và đặt lại quyết định/ghi chú cho đúng đề thi. */
  const openExamReview = (item: Exam) => {
    setReviewingExam(item);
    setDecision("APPROVE");
    setReviewNote("");
  };

  /** Gửi quyết định duyệt đề thi và làm mới hàng đợi sau khi thành công. */
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

  if (!canManage) return <AccessDenied />;
  const pendingExams = exams.filter((item) => item.status === "PENDING_REVIEW");

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow="Center Management" title="Điều hành lớp học" description="Phân công, ghi danh, duyệt học liệu và phê duyệt đề thi theo đúng vai trò." />
      <Tabs className="mt-6" items={[{ value: "members", label: "Thành viên lớp", count: (roster?.instructors.length ?? 0) + (roster?.enrollments.filter((item) => item.status === "ACTIVE").length ?? 0) }, { value: "materials", label: "Học liệu chờ duyệt", count: materialSearch.total }, { value: "exams", label: "Đề thi chờ duyệt", count: pendingExams.length }]} label="Chọn nghiệp vụ điều hành" onChange={setActiveTab} value={activeTab} />

      {activeTab === "members" ? <section className="mt-7 overflow-hidden border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">
        <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50 to-[var(--surface)] p-6">
        <div className="flex items-center gap-3">
          <UsersRound className="text-sky-700" />
          <h2 className="font-heading text-xl font-extrabold">Thành viên lớp</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500">Kiểm soát vai trò, tải giảng dạy, sĩ số và toàn bộ lịch sử thay đổi.</p>
        <div className="mt-5 max-w-xl">
          <Field label="Lớp học">
            <SearchableSelect aria-label="Tìm và chọn lớp học" onChange={(value) => { setMember({ ...member, classId: value }); setImportResults([]); }} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: `${item.term} · ${item.status}`, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={member.classId} />
          </Field>
        </div>
        </div>
        <div className="grid gap-px bg-slate-200 xl:grid-cols-2">
          <div className="bg-[var(--surface)] p-6"><h3 className="font-heading text-lg font-extrabold">Đội ngũ giảng dạy</h3><div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><UserPicker classId={member.classId} label="Chọn giảng viên" onChange={(userId) => setMember({ ...member, instructorId: userId })} role="INSTRUCTOR" value={member.instructorId} /><Field label="Vai trò"><select className={inputClass} value={member.instructorRole} onChange={(event) => setMember({ ...member, instructorRole: event.target.value as InstructorRole })}><option value="PRIMARY">Giảng viên chính</option><option value="CO_INSTRUCTOR">Đồng giảng viên</option></select></Field><div className="flex items-end"><Button aria-label="Phân công giảng viên" disabled={!member.instructorId} onClick={() => void assign("instructors")}><UserPlus size={16} />Thêm</Button></div></div><div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{roster?.instructors.map((item) => <div className="flex items-center justify-between gap-3 py-3" key={item.instructorId}><div className="min-w-0"><p className="truncate text-sm font-bold">{item.displayName ?? item.instructorId}</p><p className="truncate text-xs text-slate-500">{item.email ? `${item.email} · ` : ""}{item.role === "PRIMARY" ? "Giảng viên chính" : "Đồng giảng viên"}</p></div><Button aria-label={`Gỡ ${item.displayName ?? item.instructorId}`} onClick={() => void removeMember("instructors", item.instructorId)} variant="ghost"><Trash2 size={15} /></Button></div>)}</div></div>
          <div className="bg-[var(--surface)] p-6"><h3 className="font-heading text-lg font-extrabold">Ghi danh học viên</h3><div className="mt-4 flex items-end gap-2"><div className="min-w-0 flex-1"><UserPicker classId={member.classId} label="Chọn học viên" onChange={(userId) => setMember({ ...member, learnerId: userId })} role="LEARNER" value={member.learnerId} /></div><Button aria-label="Ghi danh học viên" disabled={!member.learnerId} onClick={() => void assign("enrollments")}><UserPlus size={16} /></Button></div><div className="mt-4"><Field label="Nhập hàng loạt — mỗi email một dòng"><textarea className={inputClass} placeholder="hocvien1@example.com&#10;hocvien2@example.com" rows={3} value={bulkLearners} onChange={(event) => setBulkLearners(event.target.value)} /></Field><Button onClick={() => void importEnrollments()} variant="secondary"><Upload size={15} />Kiểm tra & nhập</Button></div>{importResults.length ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">{importResults.map((item, index) => <p className={item.status === "ENROLLED" ? "text-emerald-700" : item.status === "FAILED" ? "text-rose-700" : "text-amber-700"} key={`${item.userId}-${index}`}>{item.userId}: {item.message}</p>)}</div> : null}<div className="mt-5 max-h-56 divide-y divide-[var(--rule)] overflow-auto border-y border-[var(--rule)]">{roster?.enrollments.filter((item) => item.status === "ACTIVE").map((item) => <div className="flex items-center justify-between gap-3 py-3" key={item.learnerId}><div className="min-w-0"><p className="truncate text-sm font-bold">{item.displayName ?? item.learnerId}</p><p className="truncate text-xs text-slate-500">{item.email ? `${item.email} · ` : ""}{item.source === "MANUAL" ? "Thủ công" : "Nhập hàng loạt"}</p></div><Button aria-label={`Gỡ ${item.displayName ?? item.learnerId}`} onClick={() => void removeMember("enrollments", item.learnerId)} variant="ghost"><Trash2 size={15} /></Button></div>)}</div></div>
        </div>
        {roster?.history.length ? <div className="border-t border-slate-100 p-6"><h3 className="flex items-center gap-2 text-sm font-extrabold"><History size={16} />Lịch sử thay đổi gần đây</h3><div className="mt-3 grid gap-2 md:grid-cols-2">{roster.history.slice(0, 6).map((item) => <div className="rounded-xl border border-slate-100 px-4 py-3 text-xs" key={item.id}><span className="font-bold">{item.memberId}</span> · {item.action}{item.reason ? ` — ${item.reason}` : ""}</div>)}</div></div> : null}
      </section> : null}

      {activeTab === "materials" ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <h2 className="font-heading text-xl font-extrabold">Học liệu chờ duyệt</h2>
          <MaterialSearchControls search={materialSearch} />
          <div className="mt-4 space-y-3">
            {materials.some((item) => item.visibility === "DRAFT") ? materials.filter((item) => item.visibility === "DRAFT").map((item) => (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4" key={item.id}>
                <div><p className="text-sm font-bold">{item.name}</p><p className="text-xs text-slate-500">{item.folder} · v{item.version}</p></div>
                <div className="flex flex-wrap gap-1"><Button onClick={() => void previewMaterial(item)} type="button" variant="ghost"><Eye size={15} />Xem</Button><Button onClick={() => void reviewMaterial(item, "APPROVE")} type="button" variant="secondary"><CheckCheck size={15} />Duyệt</Button><Button onClick={() => void reviewMaterial(item, "REVOKE")} type="button" variant="ghost"><Undo2 size={15} />Thu hồi</Button></div>
              </div>
            )) : <p className="py-8 text-center text-sm text-slate-400">Không có học liệu chờ duyệt.</p>}
          </div>
        </section> : null}

      {activeTab === "exams" ? <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <h2 className="font-heading text-xl font-extrabold">Đề thi chờ phê duyệt</h2>
          <div className="mt-4 space-y-3">
            {pendingExams.length ? pendingExams.map((item) => (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4" key={item.id}>
                <div><p className="text-sm font-bold">{item.title}</p><p className="text-xs text-slate-500">Phiên bản {item.version} · {item.questionIds.length} câu · {item.totalScore} điểm</p></div>
                <Button onClick={() => openExamReview(item)} variant="secondary"><CheckCheck size={15} />Xem xét</Button>
              </div>
            )) : <p className="py-8 text-center text-sm text-slate-400">Không có đề thi chờ phê duyệt.</p>}
          </div>
        </section> : null}

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
