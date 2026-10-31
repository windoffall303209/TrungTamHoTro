"use client";

import { History, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import { Button, Field, inputClass } from "@/shared/ui/ui";
import { UserPicker } from "@/shared/ui/user-picker";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { ClassRoster, EnrollmentImportResult, InstructorRole, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

/** Quản lý nhân sự và thành viên các lớp học. */
export default function ClassOperationsPage() {
  const { session, notify } = useApp();
  const canManage = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [member, setMember] = useState({ classId: "", instructorId: "", instructorRole: "PRIMARY" as InstructorRole, learnerId: "" });
  const [roster, setRoster] = useState<ClassRoster | null>(null);
  const [bulkLearners, setBulkLearners] = useState("");
  const [importResults, setImportResults] = useState<EnrollmentImportResult[]>([]);
  const activeClassId = useRef("");
  const rosterRequestVersion = useRef(0);

  /** Nạp danh sách lớp và khởi tạo lớp được chọn. */
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canManage) return;
    try {
      const classData = await apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode, signal });
      if (signal?.aborted) return;
      setClasses(classData);
      setMember((current) => ({ ...current, classId: current.classId || classData[0]?.id || "" }));
    } catch (error) {
      if (!signal?.aborted) notify(error instanceof Error ? error.message : "Không tải được dữ liệu điều hành.", "error");
    }
  }, [canManage, notify, session.roleCode]);

  /** Nạp giảng viên và học viên của lớp để hiển thị, phân công hoặc gỡ thành viên. */
  const loadRoster = useCallback(async (classId: string, signal?: AbortSignal) => {
    if (!classId || !canManage || classId !== activeClassId.current) return;
    const requestVersion = ++rosterRequestVersion.current;
    try {
      const data = await apiRequest<ClassRoster>(`/manager/classes/${classId}/roster`, { roleCode: session.roleCode, signal });
      if (requestVersion === rosterRequestVersion.current && !signal?.aborted && classId === activeClassId.current) setRoster(data);
    } catch (error) {
      if (requestVersion === rosterRequestVersion.current && !signal?.aborted && classId === activeClassId.current) {
        notify(error instanceof Error ? error.message : "Không tải được danh sách lớp.", "error");
      }
    }
  }, [canManage, notify, session.roleCode]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => {
    activeClassId.current = member.classId;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadRoster(member.classId, controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); rosterRequestVersion.current += 1; };
  }, [loadRoster, member.classId]);

  /** Phân công giảng viên hoặc ghi danh học viên đã chọn vào lớp. */
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
    try {
      const results = await apiRequest<EnrollmentImportResult[]>(`/manager/classes/${member.classId}/enrollments/import`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userIds }),
      });
      setImportResults(results);
      setBulkLearners("");
      await Promise.all([load(), loadRoster(member.classId)]);
      notify(`Đã xử lý ${results.length} dòng ghi danh.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không nhập được danh sách.", "error");
    }
  };

  /** Gỡ thành viên khỏi đúng nhóm nhân sự của lớp rồi tải lại danh sách. */
  const removeMember = async (kind: "instructors" | "enrollments", userId: string) => {
    const reason = window.prompt(kind === "instructors" ? "Lý do gỡ phân công giảng viên" : "Lý do gỡ học viên khỏi lớp");
    if (!reason) return;
    try {
      await apiRequest(`/manager/classes/${member.classId}/${kind}/${userId}/remove`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason }),
      });
      await Promise.all([load(), loadRoster(member.classId)]);
      notify("Đã cập nhật thành viên và lưu lịch sử.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gỡ được thành viên.", "error");
    }
  };

  if (!canManage) return <AccessDenied />;
  const selectedClassObj = classes.find((c) => c.id === member.classId);

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <PageHeader
        title="Điều hành lớp học"
        description="Phân công giảng viên, ghi danh và quản lý thành viên các lớp học."
      />

      <div className="mt-4 flex flex-col lg:flex-row items-start gap-5">
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Nghiệp vụ điều hành
            </div>

            <div className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <UsersRound size={18} className="text-sky-600 dark:text-sky-400" />
                <span className="truncate">Thành viên lớp</span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums bg-sky-200/60 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200">
                {(roster?.instructors.length ?? 0) + (roster?.enrollments.filter((item) => item.status === "ACTIVE").length ?? 0)}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 shadow-xs text-xs space-y-2.5 hidden lg:block">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tóm tắt điều hành</div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Tổng lớp:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{classes.length} lớp</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Học viên đang học:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{roster?.enrollments.filter((item) => item.status === "ACTIVE").length ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Giảng viên:</span>
              <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">{roster?.instructors.length ?? 0}</span>
            </div>
            {selectedClassObj && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 truncate">
                Đang tác nghiệp: <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedClassObj.code}</span>
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 w-full space-y-4">
          <section className="space-y-4">
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
                    setRoster(null);
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
                            <div className="size-8 rounded-full bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 font-bold grid place-items-center text-xs shrink-0">
                              {(item.displayName ?? item.instructorId).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                                {item.displayName ?? item.instructorId}
                              </p>
                              <p className="truncate text-[11px] text-slate-500">
                                {item.email ? `${item.email} · ` : ""}
                                <span className={item.role === "PRIMARY" ? "text-purple-600 dark:text-purple-400 font-semibold" : ""}>
                                  {item.role === "PRIMARY" ? "Giảng viên chính" : "Đồng giảng viên"}
                                </span>
                              </p>
                            </div>
                          </div>
                          <Button
                            aria-label={`Gỡ ${item.displayName ?? item.instructorId}`}
                            onClick={() => void removeMember("instructors", item.instructorId)}
                            variant="ghost"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 p-1.5 h-auto"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="py-6 text-center text-xs text-slate-400">Chưa có giảng viên nào được phân công.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <h3 className="font-heading text-base font-bold text-slate-900 dark:text-slate-100">Ghi danh học viên</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <UserPicker
                      classId={member.classId}
                      label="Chọn học viên"
                      onChange={(userId) => setMember({ ...member, learnerId: userId })}
                      role="LEARNER"
                      value={member.learnerId}
                    />
                    <div className="flex items-end">
                      <Button
                        aria-label="Ghi danh học viên"
                        disabled={!member.learnerId}
                        onClick={() => void assign("enrollments")}
                      >
                        <UserPlus size={16} /> Ghi danh
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <Field label="Ghi danh hàng loạt (nhập ID học viên, phân tách bằng dấu phẩy hoặc xuống dòng)">
                      <textarea
                        className={`${inputClass} text-xs`}
                        onChange={(event) => setBulkLearners(event.target.value)}
                        placeholder="usr-learner-01, usr-learner-02..."
                        rows={2}
                        value={bulkLearners}
                      />
                    </Field>
                    <div className="mt-2 flex justify-end">
                      <Button
                        disabled={!bulkLearners.trim()}
                        onClick={() => void importEnrollments()}
                        variant="secondary"
                      >
                        Nhập danh sách
                      </Button>
                    </div>
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
        </main>
      </div>
    </div>
  );
}
