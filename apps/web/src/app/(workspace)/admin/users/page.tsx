"use client";

import {
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  Search,
  UnlockKeyhole,
  UserRoundCog,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessDenied } from "@/components/access-denied";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
} from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api-client";
import { hasEveryPermission, hasPermission } from "@/lib/access-control";
import type { IdentityUser, RoleCode } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";

const roles: Array<{ code: RoleCode; label: string }> = [
  { code: "SYSTEM_ADMIN", label: "Quản trị hệ thống" },
  { code: "CENTER_MANAGER", label: "Quản lý trung tâm" },
  { code: "INSTRUCTOR", label: "Giảng viên" },
  { code: "LEARNER", label: "Học viên" },
];

const roleLabel = Object.fromEntries(
  roles.map((role) => [role.code, role.label]),
) as Record<RoleCode, string>;

/** So sánh tập vai trò không phụ thuộc thứ tự để nhận biết thay đổi thực tế. */
const sameRoles = (left: RoleCode[], right: RoleCode[]): boolean =>
  left.length === right.length && left.every((code) => right.includes(code));

interface UserForm {
  username: string;
  displayName: string;
  roleCodes: RoleCode[];
  initialPassword: string;
}
interface IdentityChangeImpact {
  userId: string;
  currentRoleCode: RoleCode;
  currentStatus: IdentityUser["status"];
  nextRoleCode: RoleCode;
  nextStatus: IdentityUser["status"];
  token: string;
  requiresHandoff: boolean;
  activeSessions: number;
  classes: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    assignmentRole: "PRIMARY" | "CO_INSTRUCTOR";
  }>;
  openWork: {
    regrades: number;
    interventions: number;
    supportTickets: number;
    moderationReports: number;
    upcomingSessions: number;
  };
}
const emptyForm: UserForm = {
  username: "",
  displayName: "",
  roleCodes: ["LEARNER"],
  initialPassword: "",
};

/** Quản lý danh tính người dùng, vai trò và trạng thái khóa tài khoản. */
export default function UsersPage() {
  const { session, notify } = useApp();
  const canView =
    (session.roleCode === "SYSTEM_ADMIN" || session.roleCode === "CENTER_MANAGER") &&
    hasPermission(session, "user:view");
  // Quản lý trung tâm cấp được mọi vai trò trừ Quản trị hệ thống; API kiểm tra lại quy tắc này.
  const assignableRoles =
    session.roleCode === "SYSTEM_ADMIN"
      ? roles
      : roles.filter((role) => role.code !== "SYSTEM_ADMIN");
  const canCreate = hasPermission(session, "user:create");
  const canUpdate = hasPermission(session, "user:update");
  const canSuspend = hasEveryPermission(session, [
    "user:update",
    "user:suspend",
  ]);
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState<IdentityUser | null>(null);
  const [editStatus, setEditStatus] =
    useState<IdentityUser["status"]>("ACTIVE");
  const [impact, setImpact] = useState<IdentityChangeImpact | null>(null);
  const [handoffUserId, setHandoffUserId] = useState("");
  const [handoffReason, setHandoffReason] = useState("");
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totals, setTotals] = useState({ total: 0, active: 0, locked: 0 });
  const requestVersion = useRef(0);
  const [handoffQuery, setHandoffQuery] = useState("");
  const [handoffUsers, setHandoffUsers] = useState<IdentityUser[]>([]);
  // Tìm người nhận độc lập với trang tài khoản đang hiển thị.
  useEffect(() => {
    if (!impact?.requiresHandoff) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiRequest<{ items: IdentityUser[] }>(`/admin/users?pageSize=50&query=${encodeURIComponent(handoffQuery)}`, { roleCode: session.roleCode, signal: controller.signal })
        .then((data) => setHandoffUsers(data.items)).catch(() => { if (!controller.signal.aborted) setHandoffUsers([]); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [handoffQuery, impact?.requiresHandoff, session.roleCode]);

  /** Nạp danh sách người dùng theo truy vấn tìm kiếm hiện tại. */
  const loadUsers = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const data = await apiRequest<{ items: IdentityUser[]; total: number; active: number; locked: number }>(
        `/admin/users?page=${page}&pageSize=${pageSize}&query=${encodeURIComponent(query)}`,
        { roleCode: session.roleCode },
      );
      if (version !== requestVersion.current) return;
      setUsers(data.items);
      setTotals(data);
      if (page > 1 && !data.items.length) setPage(Math.max(1, Math.ceil(data.total / pageSize)));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được danh sách người dùng.",
        "error",
      );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [notify, query, page, pageSize, session.roleCode]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadUsers(), 220);
    return () => window.clearTimeout(timeout);
  }, [loadUsers]);

  /** Mở hộp thoại tạo với biểu mẫu người dùng rỗng. */
  const openCreate = () => {
    setForm(emptyForm);
    setShowPassword(false);
    setCreateOpen(true);
  };
  /** Sao chép thông tin tài khoản đã chọn vào biểu mẫu chỉnh sửa. */
  const openEdit = (
    user: IdentityUser,
    status: IdentityUser["status"] = user.status,
  ) => {
    setEditing(user);
    setEditStatus(status);
    setImpact(null);
    setHandoffUserId("");
    setHandoffReason("");
    setForm({
      username: user.username,
      displayName: user.displayName,
      roleCodes: user.roleCodes?.length ? user.roleCodes : [user.roleCode],
      initialPassword: "",
    });
  };

  /** Tạo tài khoản chưa xác thực với tên đăng nhập, mật khẩu tạm và các vai trò ban đầu. */
  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest<IdentityUser>("/admin/users", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          username: form.username,
          initialPassword: form.initialPassword,
          roleCode: form.roleCodes[0],
          roleCodes: form.roleCodes,
        }),
      });
      notify("Đã tạo tài khoản. Hãy gửi tên tài khoản và mật khẩu tạm thời cho người dùng.");
      setCreateOpen(false);
      await loadUsers();
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Không thể tạo tài khoản.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Cập nhật thông tin và vai trò của tài khoản đang chọn. */
  const updateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const changesAccess =
        !sameRoles(form.roleCodes, editing.roleCodes ?? [editing.roleCode]) ||
        editStatus !== editing.status;
      if (changesAccess && !impact) {
        const preview = await apiRequest<IdentityChangeImpact>(
          `/admin/users/${editing.id}/change-impact?roleCodes=${encodeURIComponent(form.roleCodes.join(","))}&status=${encodeURIComponent(editStatus)}`,
          { roleCode: session.roleCode },
        );
        setImpact(preview);
        return;
      }
      await apiRequest<IdentityUser>(`/admin/users/${editing.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          displayName: form.displayName,
          roleCode: form.roleCodes[0],
          roleCodes: form.roleCodes,
          status: editStatus,
          impactToken: impact?.token,
          handoffUserId: impact?.requiresHandoff ? handoffUserId : undefined,
          handoffReason: impact?.requiresHandoff ? handoffReason : undefined,
        }),
      });
      notify("Đã cập nhật tài khoản.");
      setEditing(null);
      await loadUsers();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật tài khoản.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Khóa hoặc mở khóa tài khoản; tài khoản chưa từng xác thực (chưa có email) mở khóa thì về Chưa xác thực. */
  const toggleLock = (user: IdentityUser) => {
    const nextStatus = user.status === "LOCKED" ? (user.email ? "ACTIVE" : "PENDING") : "LOCKED";
    openEdit(user, nextStatus);
  };

  /** Dùng chung biểu mẫu tạo/sửa và điều chỉnh các trường theo ngữ cảnh. */
  const formContent = (
    creating: boolean,
  ) => (
    <form className="space-y-5" onSubmit={(event) => void (creating ? createUser(event) : updateUser(event))}>
      {creating ? (
        <>
          <Field label="Tài khoản">
            <input
              autoCapitalize="none"
              autoComplete="username"
              className={inputClass}
              maxLength={32}
              minLength={4}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  username: event.target.value.toLowerCase(),
                }))
              }
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]{3,31}"
              required
              spellCheck={false}
              value={form.username}
            />
          </Field>
          <Field label="Mật khẩu tạm thời">
            <span className="relative block">
              <input
                autoComplete="new-password"
                className={`${inputClass} pr-12`}
                maxLength={128}
                minLength={8}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    initialPassword: event.target.value,
                  }))
                }
                required
                type={showPassword ? "text" : "password"}
                value={form.initialPassword}
              />
              <button
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
                onClick={() => setShowPassword((value) => !value)}
                type="button"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </Field>
        </>
      ) : (
        <Field label="Họ và tên">
          <input
            className={inputClass}
            minLength={2}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                displayName: event.target.value,
              }))
            }
            required
            value={form.displayName}
          />
        </Field>
      )}
      <Field label="Vai trò sử dụng">
        <div className="grid gap-2 sm:grid-cols-2">
          {(creating ? assignableRoles : roles).map((role) => (
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-3 py-2 text-sm font-bold" key={role.code}>
              <input
                checked={form.roleCodes.includes(role.code)}
                className="size-5 accent-[var(--accent-deep)]"
                onChange={(event) => {
                  setImpact(null);
                  setForm((current) => {
                    const roleCodes = event.target.checked
                      ? [...current.roleCodes, role.code]
                      : current.roleCodes.filter((code) => code !== role.code);
                    return { ...current, roleCodes };
                  });
                }}
                type="checkbox"
              />
              {role.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-soft)]">Người dùng chuyển vai trò đang dùng trong header; thêm vai trò không xóa các vai trò còn lại.</p>
      </Field>
      {!creating ? (
        <Field label="Trạng thái">
          <select
            className={inputClass}
            onChange={(event) => {
              setImpact(null);
              setEditStatus(event.target.value as IdentityUser["status"]);
            }}
            value={editStatus}
          >
            {editing && !editing.email ? (
              <option value="PENDING">Chưa xác thực</option>
            ) : null}
            <option value="ACTIVE">Hoạt động</option>
            <option value="INACTIVE">Ngừng hoạt động</option>
            <option value="LOCKED">Bị khóa</option>
          </select>
        </Field>
      ) : null}
      {!creating && impact ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/40 p-4">
          <p className="text-sm font-extrabold text-amber-950 dark:text-amber-200">Ảnh hưởng trước khi áp dụng</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--ink-soft)]">
            <li>{impact.classes.length} lớp đang phụ trách</li>
            <li>
              {impact.openWork.regrades} phúc khảo ·{" "}
              {impact.openWork.interventions} can thiệp ·{" "}
              {impact.openWork.upcomingSessions} buổi học
            </li>
            <li>
              {impact.openWork.supportTickets} phiếu hỗ trợ ·{" "}
              {impact.openWork.moderationReports} hồ sơ kiểm duyệt
            </li>
            <li>{impact.activeSessions} phiên đăng nhập sẽ bị thu hồi ngay</li>
          </ul>
          {impact.classes.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {impact.classes.map((item) => (
                <span
                  className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold"
                  key={item.id}
                >
                  {item.code} ·{" "}
                  {item.assignmentRole === "PRIMARY" ? "GV chính" : "Đồng GV"}
                </span>
              ))}
            </div>
          ) : null}
          {impact.requiresHandoff ? (
            <div className="mt-4 space-y-3">
              <Field label="Người nhận bàn giao">
                <input className={inputClass} aria-label="Tìm người nhận bàn giao" placeholder="Tìm theo tên hoặc email" value={handoffQuery} onChange={(event) => { setHandoffQuery(event.target.value); setHandoffUserId(""); }} />
                <select
                  className={inputClass}
                  onChange={(event) => setHandoffUserId(event.target.value)}
                  required
                  value={handoffUserId}
                >
                  <option value="">Chọn tài khoản phù hợp…</option>
                  {handoffUsers
                    .filter(
                      (user) =>
                        user.id !== editing?.id && user.status === "ACTIVE",
                    )
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName} · {(user.roleCodes ?? [user.roleCode]).map((code) => roleLabel[code]).join(", ")}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Lý do bàn giao">
                <textarea
                  className={inputClass}
                  minLength={5}
                  onChange={(event) => setHandoffReason(event.target.value)}
                  required
                  rows={3}
                  value={handoffReason}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
        <Button
          onClick={() =>
            creating ? setCreateOpen(false) : setEditing(null)
          }
          type="button"
          variant="secondary"
        >
          Hủy
        </Button>
        <Button
          disabled={
            form.roleCodes.length === 0 ||
            Boolean(
              impact?.requiresHandoff &&
                (!handoffUserId || handoffReason.trim().length < 5),
            )
          }
          loading={saving}
          type="submit"
        >
          {creating
            ? "Tạo tài khoản"
            : impact
              ? "Xác nhận áp dụng"
              : !sameRoles(form.roleCodes, editing?.roleCodes ?? (editing ? [editing.roleCode] : [])) ||
                  editStatus !== editing?.status
                ? "Xem ảnh hưởng"
                : "Lưu thay đổi"}
        </Button>
      </div>
    </form>
  );

  if (!canView) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <PageHeader
        actions={
          canCreate ? (
            <Button onClick={openCreate}>
              <Plus size={17} />
              Tạo tài khoản
            </Button>
          ) : undefined
        }
        description="Tạo, cập nhật, khóa và khôi phục tài khoản. Mọi thay đổi đều được ghi lại để truy vết."
        eyebrow="Identity & Access · FUNC-ADM-001"
        title="Quản lý người dùng"
      />
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs text-center">
          <p className="tabular text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{totals.active}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Đang hoạt động</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs text-center">
          <p className="tabular text-2xl sm:text-3xl font-extrabold text-rose-600 dark:text-rose-400">{totals.locked}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Đã khóa</p>
        </div>
      </section>
      <div className="mt-6 flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <input
            aria-label="Tìm kiếm người dùng"
            className={`${inputClass} pl-10`}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo tài khoản, tên hoặc email…"
            value={query}
          />
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-3.5">Người dùng</th>
                <th className="px-5 py-3.5">Vai trò</th>
                <th className="px-5 py-3.5">Trạng thái</th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    className="px-5 py-10 text-center text-sm text-[var(--ink-soft)]"
                    colSpan={4}
                  >
                    Đang tải danh sách…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    className="px-5 py-10 text-center text-sm text-[var(--ink-soft)]"
                    colSpan={4}
                  >
                    Không tìm thấy tài khoản phù hợp.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr className="hover:bg-slate-50/70" key={user.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="grid size-9 place-items-center rounded-full bg-sky-50 text-xs font-extrabold text-sky-700">
                          {user.displayName
                            .split(" ")
                            .slice(-2)
                            .map((part) => part[0])
                            .join("")}
                        </div>
                        <div>
                          <p className="text-sm font-bold">
                            {user.displayName}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-[var(--ink-soft)]">
                            @{user.username}
                          </p>
                          {user.email ? (
                            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                              {user.email}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-[var(--ink-soft)]">
                      {(user.roleCodes ?? [user.roleCode]).map((code) => roleLabel[code]).join(", ")}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        {canUpdate ? (
                          <Button
                            aria-label={`Sửa ${user.displayName}`}
                            onClick={() => openEdit(user)}
                            variant="ghost"
                          >
                            <UserRoundCog size={16} />
                            Sửa
                          </Button>
                        ) : null}
                        {canSuspend ? (
                          <Button
                            aria-label={`${user.status === "LOCKED" ? "Mở khóa" : "Khóa"} ${user.displayName}`}
                            onClick={() => void toggleLock(user)}
                            variant="ghost"
                          >
                            {user.status === "LOCKED" ? (
                              <UnlockKeyhole size={16} />
                            ) : (
                              <LockKeyhole size={16} />
                            )}
                            {user.status === "LOCKED" ? "Mở khóa" : "Khóa"}
                          </Button>
                        ) : null}
                        {!canUpdate && !canSuspend ? (
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">
                            Chỉ xem
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination
        itemLabel="tài khoản"
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        page={page}
        pageSize={pageSize}
        totalItems={totals.total}
      />
      <Modal
        description="Tài khoản mới được tạo ở trạng thái chưa xác thực với mật khẩu tạm thời do bạn cấp."
        onClose={() => setCreateOpen(false)}
        open={canCreate && createOpen}
        title="Tạo tài khoản"
      >
        {formContent(true)}
      </Modal>
      <Modal
        description="Thay đổi quyền cần xem trước ảnh hưởng; công việc được bàn giao trước và mọi phiên đang mở bị thu hồi ngay."
        onClose={() => setEditing(null)}
        open={canUpdate && Boolean(editing)}
        title="Cập nhật tài khoản"
      >
        {formContent(false)}
      </Modal>
    </div>
  );
}
