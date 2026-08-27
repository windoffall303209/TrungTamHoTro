"use client";

import { LockKeyhole, Plus, Search, UnlockKeyhole, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessDenied } from "@/components/access-denied";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api-client";
import type { IdentityUser, RoleCode } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";

const roles: Array<{ code: RoleCode; label: string }> = [
  { code: "SYSTEM_ADMIN", label: "Quản trị hệ thống" },
  { code: "CENTER_MANAGER", label: "Quản lý trung tâm" },
  { code: "INSTRUCTOR", label: "Giảng viên" },
  { code: "LEARNER", label: "Học viên" },
];

const roleLabel = Object.fromEntries(roles.map((role) => [role.code, role.label])) as Record<RoleCode, string>;

interface UserForm { displayName: string; email: string; roleCode: RoleCode }
const emptyForm: UserForm = { displayName: "", email: "", roleCode: "LEARNER" };

export default function UsersPage() {
  const { session, notify } = useApp();
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityUser | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<IdentityUser[]>(`/admin/users${query ? `?query=${encodeURIComponent(query)}` : ""}`, { roleCode: session.roleCode });
      setUsers(data);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được danh sách người dùng.", "error");
    } finally { setLoading(false); }
  }, [notify, query, session.roleCode]);

  useEffect(() => { const timeout = window.setTimeout(() => void loadUsers(), 220); return () => window.clearTimeout(timeout); }, [loadUsers]);

  const totals = useMemo(() => ({ active: users.filter((user) => user.status === "ACTIVE").length, locked: users.filter((user) => user.status === "LOCKED").length }), [users]);

  const openCreate = () => { setForm(emptyForm); setCreateOpen(true); };
  const openEdit = (user: IdentityUser) => { setEditing(user); setForm({ displayName: user.displayName, email: user.email, roleCode: user.roleCode }); };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await apiRequest<IdentityUser>("/admin/users", { method: "POST", roleCode: session.roleCode, body: JSON.stringify(form) });
      notify("Đã tạo tài khoản và ghi audit log."); setCreateOpen(false); await loadUsers();
    } catch (error) { notify(error instanceof ApiError ? error.message : "Không thể tạo tài khoản.", "error"); }
    finally { setSaving(false); }
  };

  const updateUser = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing) return; setSaving(true);
    try {
      await apiRequest<IdentityUser>(`/admin/users/${editing.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ displayName: form.displayName, roleCode: form.roleCode }) });
      notify("Đã cập nhật tài khoản."); setEditing(null); await loadUsers();
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể cập nhật tài khoản.", "error"); }
    finally { setSaving(false); }
  };

  const toggleLock = async (user: IdentityUser) => {
    const nextStatus = user.status === "LOCKED" ? "ACTIVE" : "LOCKED";
    try {
      await apiRequest<IdentityUser>(`/admin/users/${user.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ status: nextStatus }) });
      notify(nextStatus === "LOCKED" ? "Đã khóa tài khoản." : "Đã khôi phục tài khoản."); await loadUsers();
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể đổi trạng thái.", "error"); }
  };

  const formContent = (submit: (event: React.FormEvent) => Promise<void>, includeEmail: boolean) => <form className="space-y-5" onSubmit={(event) => void submit(event)}>
    <Field label="Họ và tên"><input className={inputClass} minLength={2} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required value={form.displayName} /></Field>
    {includeEmail ? <Field label="Email"><input className={inputClass} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={form.email} /></Field> : null}
    <Field label="Vai trò"><select className={inputClass} onChange={(event) => setForm((current) => ({ ...current, roleCode: event.target.value as RoleCode }))} value={form.roleCode}>{roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select></Field>
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-5"><Button onClick={() => includeEmail ? setCreateOpen(false) : setEditing(null)} type="button" variant="secondary">Hủy</Button><Button loading={saving} type="submit">{includeEmail ? "Tạo tài khoản" : "Lưu thay đổi"}</Button></div>
  </form>;

  if (session.roleCode !== "SYSTEM_ADMIN") return <AccessDenied />;

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
    <PageHeader actions={<Button onClick={openCreate}><Plus size={17} />Tạo tài khoản</Button>} description="Tạo, cập nhật, khóa và khôi phục tài khoản. Mọi thay đổi đều được ghi lại để truy vết." eyebrow="Identity & Access · FUNC-ADM-001" title="Quản lý người dùng" />
    <section className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 md:max-w-md"><div className="py-5 pr-6"><p className="text-2xl font-extrabold">{totals.active}</p><p className="text-xs font-semibold text-slate-500">Đang hoạt động</p></div><div className="py-5 pl-6"><p className="text-2xl font-extrabold">{totals.locked}</p><p className="text-xs font-semibold text-slate-500">Đã khóa</p></div></section>
    <div className="mt-7 flex items-center gap-3"><div className="relative max-w-md flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input aria-label="Tìm kiếm người dùng" className={`${inputClass} pl-10`} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc email…" value={query} /></div></div>
    <div className="mt-5 overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/65"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3.5">Người dùng</th><th className="px-5 py-3.5">Vai trò</th><th className="px-5 py-3.5">Trạng thái</th><th className="px-5 py-3.5 text-right">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">
      {loading ? <tr><td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={4}>Đang tải danh sách…</td></tr> : users.length === 0 ? <tr><td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={4}>Không tìm thấy tài khoản phù hợp.</td></tr> : users.map((user) => <tr className="hover:bg-slate-50/70" key={user.id}><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-sky-50 text-xs font-extrabold text-sky-700">{user.displayName.split(" ").slice(-2).map((part) => part[0]).join("")}</div><div><p className="text-sm font-bold">{user.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{user.email}</p></div></div></td><td className="px-5 py-4 text-sm font-medium text-slate-600">{roleLabel[user.roleCode]}</td><td className="px-5 py-4"><StatusBadge status={user.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button aria-label={`Sửa ${user.displayName}`} onClick={() => openEdit(user)} variant="ghost"><UserRoundCog size={16} />Sửa</Button><Button aria-label={`${user.status === "LOCKED" ? "Mở khóa" : "Khóa"} ${user.displayName}`} onClick={() => void toggleLock(user)} variant="ghost">{user.status === "LOCKED" ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}{user.status === "LOCKED" ? "Mở khóa" : "Khóa"}</Button></div></td></tr>)}
    </tbody></table></div></div>
    <Modal description="Email phải duy nhất. Tài khoản mới được kích hoạt ngay và nhận vai trò đã chọn." onClose={() => setCreateOpen(false)} open={createOpen} title="Tạo tài khoản">{formContent(createUser, true)}</Modal>
    <Modal description="Thay đổi vai trò có hiệu lực với phiên làm việc kế tiếp và được lưu trong audit log." onClose={() => setEditing(null)} open={Boolean(editing)} title="Cập nhật tài khoản">{formContent(updateUser, false)}</Modal>
  </div>;
}
