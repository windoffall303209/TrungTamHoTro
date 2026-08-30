"use client";

import { Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { IdentityRole, PermissionCode, RoleCode } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";

const permissionGroups: Array<{ name: string; permissions: Array<{ code: PermissionCode; label: string }> }> = [
  { name: "Người dùng & quyền", permissions: [{ code: "user:view", label: "Xem người dùng" }, { code: "user:create", label: "Tạo người dùng" }, { code: "user:update", label: "Cập nhật người dùng" }, { code: "user:suspend", label: "Khóa tài khoản" }, { code: "role:view", label: "Xem vai trò" }, { code: "role:update", label: "Sửa ma trận quyền" }] },
  { name: "Khóa học & lớp", permissions: [{ code: "course:view", label: "Xem khóa học" }, { code: "course:manage", label: "Quản lý khóa học" }, { code: "class:view", label: "Xem lớp" }, { code: "class:manage", label: "Quản lý lớp" }] },
  { name: "Nội dung giảng dạy", permissions: [{ code: "material:view", label: "Xem học liệu" }, { code: "material:manage", label: "Quản lý học liệu" }, { code: "question:view", label: "Xem câu hỏi" }, { code: "question:manage", label: "Quản lý câu hỏi" }, { code: "exam:view", label: "Xem đề" }, { code: "exam:manage", label: "Quản lý đề" }] },
  { name: "Tương tác & vận hành", permissions: [{ code: "forum:view", label: "Xem diễn đàn" }, { code: "forum:post", label: "Đăng bài" }, { code: "forum:moderate", label: "Kiểm duyệt" }, { code: "session:view", label: "Xem buổi học" }, { code: "session:manage", label: "Quản lý buổi học" }, { code: "report:view", label: "Xem báo cáo" }, { code: "support:create", label: "Tạo ticket" }, { code: "support:manage", label: "Xử lý ticket" }, { code: "system:configure", label: "Cấu hình hệ thống" }] },
];

export default function RolesPage() {
  const { session, notify } = useApp();
  const canView = hasPermission(session, "role:view");
  const canUpdate = hasPermission(session, "role:update");
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [selectedCode, setSelectedCode] = useState<RoleCode>("CENTER_MANAGER");
  const [draft, setDraft] = useState<PermissionCode[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const data = await apiRequest<IdentityRole[]>("/admin/roles", { roleCode: session.roleCode }); setRoles(data); const initial = data.find((role) => role.code === "CENTER_MANAGER") ?? data[0]; if (initial) { setSelectedCode(initial.code); setDraft([...initial.permissions]); } }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được ma trận quyền.", "error"); }
  }, [notify, session.roleCode]);
  useEffect(() => { window.queueMicrotask(() => void load()); }, [load]);
  const selected = useMemo(() => roles.find((role) => role.code === selectedCode), [roles, selectedCode]);

  const toggle = (code: PermissionCode) => {
    if (!canUpdate) return;
    setDraft((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };
  const save = async () => {
    setSaving(true);
    try {
      const updated = await apiRequest<IdentityRole>(`/admin/roles/${selectedCode}/permissions`, { method: "PUT", roleCode: session.roleCode, body: JSON.stringify({ roleCode: selectedCode, permissions: draft }) });
      setRoles((current) => current.map((role) => role.code === updated.code ? updated : role)); notify(`Đã lưu ma trận quyền phiên bản ${updated.version}.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể lưu ma trận quyền.", "error"); }
    finally { setSaving(false); }
  };

  if (!canView) return <AccessDenied />;

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10"><PageHeader actions={canUpdate ? <Button loading={saving} onClick={() => void save()}><Save size={17} />Lưu ma trận</Button> : undefined} description="Bật hoặc tắt quyền theo vai trò. Các thay đổi được tăng phiên bản và ghi audit để phiên đang hoạt động có thể làm mới." eyebrow="Identity & Access · FUNC-ADM-002" title="Vai trò và quyền" />
    <div className="mt-8 grid gap-7 lg:grid-cols-[280px_1fr]"><aside aria-label="Danh sách vai trò" className="overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/65">{roles.map((role) => <button aria-pressed={selectedCode === role.code} className={`min-h-20 w-full border-b border-[#d5dfe2] p-4 text-left transition last:border-b-0 ${selectedCode === role.code ? "bg-[#f8ece6] text-[#102a43]" : "hover:bg-[#eee8dc]/65"}`} key={role.code} onClick={() => { setSelectedCode(role.code); setDraft([...role.permissions]); }} type="button"><div className="flex items-center justify-between gap-3"><p className="font-bold">{role.name}</p><span className={`text-xs font-extrabold ${selectedCode === role.code ? "text-[#963f2a]" : "text-[#657789]"}`}>v{role.version}</span></div><p className={`mt-2 text-xs leading-5 ${selectedCode === role.code ? "text-[#963f2a]" : "text-[#516274]"}`}>{role.description}</p></button>)}</aside>
      <section className="overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/65"><div className="flex items-center gap-3 border-b border-slate-200 px-5 py-5 md:px-7"><div className="grid size-10 place-items-center rounded-xl bg-[#f8ece6] text-[#963f2a]"><ShieldCheck size={20} /></div><div><h2 className="font-heading text-xl font-extrabold">{selected?.name ?? "Đang tải…"}</h2><p className="text-xs text-[#516274]">{draft.length} quyền đang được cấp</p></div></div>
        <div className="divide-y divide-slate-100">{permissionGroups.map((group) => <div className="grid gap-4 px-5 py-5 md:grid-cols-[180px_1fr] md:px-7" key={group.name}><h3 className="text-sm font-extrabold text-slate-700">{group.name}</h3><div className="grid gap-1 sm:grid-cols-2">{group.permissions.map((permission) => <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50" key={permission.code}><input checked={draft.includes(permission.code)} className="size-5 accent-sky-600" disabled={!canUpdate} onChange={() => toggle(permission.code)} type="checkbox" /><span>{permission.label}</span><code className="ml-auto hidden text-[10px] text-slate-400 xl:block">{permission.code}</code></label>)}</div></div>)}</div>
      </section></div>
  </div>;
}
