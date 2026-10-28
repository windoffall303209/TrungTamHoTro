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
  const selectedClassObj = classes.find((c) => c.id === member.classId);

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <PageHeader
        title="Điều hành lớp học"
        description="Phân công, ghi danh, duyệt học liệu và phê duyệt đề thi theo đúng vai trò."
      />

      {/* BỐ CỤC 2 CỘT: HEADER DỌC ĐIỀU HÀNH (TRÁI) + VÙNG TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="mt-4 flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC: 3 CHỨC NĂNG CON */}
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Nghiệp vụ điều hành
            </div>

            <button
              type="button"
              onClick={() => setActiveTab("members")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === "members"
                  ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <UsersRound size={18} className={activeTab === "members" ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                <span className="truncate">Thành viên lớp</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                activeTab === "members"
                  ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}>
                {(roster?.instructors.length ?? 0) + (roster?.enrollments.filter((item) => item.status === "ACTIVE").length ?? 0)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("materials")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === "materials"
                  ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Upload size={18} className={activeTab === "materials" ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                <span className="truncate">Duyệt học liệu</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                activeTab === "materials"
                  ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}>
                {materialSearch.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("exams")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === "exams"
                  ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCheck size={18} className={activeTab === "exams" ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                <span className="truncate">Duyệt đề thi</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                activeTab === "exams"
                  ? "bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}>
                {pendingExams.length}
              </span>
            </button>
          </div>

          {/* Widget tóm tắt nhỏ phía dưới để không bị trống trải */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 shadow-xs text-xs space-y-2.5 hidden lg:block">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tóm tắt điều hành</div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Tổng lớp:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{classes.length} lớp</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Học liệu chờ duyệt:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">{materialSearch.total}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Đề thi chờ duyệt:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{pendingExams.length}</span>
            </div>
            {selectedClassObj && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 truncate">
                Đang tác nghiệp: <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedClassObj.code}</span>
              </div>
            )}
          </div>
        </aside>

        {/* CỘT PHẢI: VÙNG TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full space-y-4">
          {activeTab === "members" ? (
            <section className="space-y-4">
              {/* THANH CHỌN LỚP TÁC NGHIỆP CÙNG HÀNG (SINGLE ROW TOOLBAR) */}
              <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap sm:flex-nowrap items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <UsersRound size={17} className="text-sky-600 dark:text-sky-400" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Lớp tác nghiệp:</span>
                </div>
                <div className="flex-1 min-w-[240px]">
                  <SearchableSelect
                    aria-label="Tìm và chọn lớp học"
                    onChange={(value) => {
                      setMember({ ...member, classId: value });
                      setImportResults([]);
                    }}
                    options={classes.map((item) => ({
                      value: item.id,
                      label: `${item.code} — ${item.name}`,
                      description: `${item.term} · ${item.status}`,
                      keywords: item.id,
                    }))}
                    placeholder="Gõ mã hoặc tên lớp để lọc…"
                    value={member.classId}
                  />
                </div>
                {selectedClassObj && (
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 text-sky-700 dark:text-sky-300 text-xs font-bold tabular-nums">
                      {roster?.enrollments.filter((item) => item.status === "ACTIVE").length ?? 0} học viên
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 border border-purple-200/80 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 text-xs font-bold tabular-nums">
                      {roster?.instructors.length ?? 0} giảng viên
                    </span>
                  </div>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {/* Cột 1: Giảng viên */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-heading text-base font-bold text-slate-900 dark:text-slate-100">Đội ngũ giảng dạy</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <UserPicker
                    classId={member.classId}
                    label="Chọn giảng viên"
                    onChange={(userId) => setMember({ ...member, instructorId: userId })}
                    role="INSTRUCTOR"
                    value={member.instructorId}
                  />
                  <Field label="Vai trò">
                    <select
                      className={inputClass}
                      value={member.instructorRole}
                      onChange={(event) => setMember({ ...member, instructorRole: event.target.value as InstructorRole })}
                    >
                      <option value="PRIMARY">Giảng viên chính</option>
                      <option value="CO_INSTRUCTOR">Đồng giảng viên</option>
                    </select>
                  </Field>
                  <div className="flex items-end">
                    <Button
                      aria-label="Phân công giảng viên"
                      disabled={!member.instructorId}
                      onClick={() => void assign("instructors")}
                    >
                      <UserPlus size={16} /> Thêm
                    </Button>
                  </div>
                </div>

                <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                  {roster?.instructors.length ? (
                    roster.instructors.map((item) => (
                      <div className="flex items-center justify-between gap-3 py-3" key={item.instructorId}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="size-8 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-bold grid place-items-center text-xs shrink-0">
                            {(item.displayName ?? item.instructorId).slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                              {item.displayName ?? item.instructorId}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {item.email ? `${item.email} · ` : ""}
                              {item.role === "PRIMARY" ? "Giảng viên chính" : "Đồng giảng viên"}
                            </p>
                          </div>
                        </div>
                        <Button
                          aria-label={`Gỡ ${item.displayName ?? item.instructorId}`}
                          onClick={() => void removeMember("instructors", item.instructorId)}
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-xs text-slate-400">Chưa có giảng viên được phân công.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Cột 2: Ghi danh học viên */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-heading text-base font-bold text-slate-900 dark:text-slate-100">Ghi danh học viên</h3>
                <div className="mt-4 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <UserPicker
                      classId={member.classId}
                      label="Chọn học viên"
                      onChange={(userId) => setMember({ ...member, learnerId: userId })}
                      role="LEARNER"
                      value={member.learnerId}
                    />
                  </div>
                  <Button
                    aria-label="Ghi danh học viên"
                    disabled={!member.learnerId}
                    onClick={() => void assign("enrollments")}
                  >
                    <UserPlus size={16} /> Ghi danh
                  </Button>
                </div>

                <div className="mt-4">
                  <Field label="Nhập hàng loạt — mỗi email/mã một dòng">
                    <textarea
                      className={inputClass}
                      placeholder="hocvien1@example.com&#10;hocvien2@example.com"
                      rows={3}
                      value={bulkLearners}
                      onChange={(event) => setBulkLearners(event.target.value)}
                    />
                  </Field>
                  <Button onClick={() => void importEnrollments()} variant="secondary" className="mt-2">
                    <Upload size={15} /> Kiểm tra & nhập
                  </Button>
                </div>

                {importResults.length ? (
                  <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                    {importResults.map((item, index) => (
                      <p
                        className={
                          item.status === "ENROLLED"
                            ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                            : item.status === "FAILED"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400"
                        }
                        key={`${item.userId}-${index}`}
                      >
                        {item.userId}: {item.message}
                      </p>
                    ))}
                  </div>
                ) : null}

                <div className="mt-5 max-h-56 divide-y divide-slate-100 dark:divide-slate-800 overflow-auto border-t border-slate-100 dark:border-slate-800">
                  {roster?.enrollments.filter((item) => item.status === "ACTIVE").map((item) => (
                    <div className="flex items-center justify-between gap-3 py-2.5" key={item.learnerId}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="size-7 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-bold grid place-items-center text-xs shrink-0">
                          {(item.displayName ?? item.learnerId).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                            {item.displayName ?? item.learnerId}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {item.email ? `${item.email} · ` : ""}
                            {item.source === "MANUAL" ? "Thủ công" : "Nhập hàng loạt"}
                          </p>
                        </div>
                      </div>
                      <Button
                        aria-label={`Gỡ ${item.displayName ?? item.learnerId}`}
                        onClick={() => void removeMember("enrollments", item.learnerId)}
                        variant="ghost"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 p-1 h-auto"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {roster?.history.length ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <History size={16} /> Lịch sử thay đổi gần đây
              </h3>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {roster.history.slice(0, 6).map((item) => (
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-2.5 text-xs" key={item.id}>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{item.memberId}</span> · {item.action}
                    {item.reason ? ` — ${item.reason}` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "materials" ? (
        <section className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
          <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Học liệu chờ duyệt</h2>
          <MaterialSearchControls search={materialSearch} />
          <div className="mt-4 space-y-2.5">
            {materials.some((item) => item.visibility === "DRAFT") ? (
              materials
                .filter((item) => item.visibility === "DRAFT")
                .map((item) => (
                  <div
                    className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3.5 hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                    key={item.id}
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.folder} · v{item.version}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button onClick={() => void previewMaterial(item)} type="button" variant="ghost">
                        <Eye size={15} /> Xem
                      </Button>
                      <Button onClick={() => void reviewMaterial(item, "APPROVE")} type="button" variant="secondary">
                        <CheckCheck size={15} /> Duyệt
                      </Button>
                      <Button onClick={() => void reviewMaterial(item, "REVOKE")} type="button" variant="ghost">
                        <Undo2 size={15} /> Thu hồi
                      </Button>
                    </div>
                  </div>
                ))
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">Không có học liệu chờ duyệt.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "exams" ? (
        <section className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
          <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Đề thi chờ phê duyệt</h2>
          <div className="mt-4 space-y-2.5">
            {pendingExams.length ? (
              pendingExams.map((item) => (
                <div
                  className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3.5 hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                  key={item.id}
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.title}</p>
                    <p className="text-xs text-slate-500">
                      Phiên bản {item.version} · {item.questionIds.length} câu · {item.totalScore} điểm
                    </p>
                  </div>
                  <Button onClick={() => openExamReview(item)} variant="secondary">
                    <CheckCheck size={15} /> Xem xét
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">Không có đề thi chờ phê duyệt.</p>
            )}
          </div>
        </section>
      ) : null}
      </main>
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
