"use client";

import { Clock3, ExternalLink, History, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface Summary { session: LiveSession; attendance: { attendedMinutes: number; status: string; adjustmentReason?: string } }
export default function LearningHistoryPage() {
  const { session, notify } = useApp(); const [items, setItems] = useState<LiveSession[]>([]); const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const load = useCallback(async () => { if (session.roleCode !== "LEARNER") return; try { setItems(await apiRequest<LiveSession[]>("/sessions", { roleCode: session.roleCode })); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được lịch sử học tập.", "error"); } }, [notify, session.roleCode]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const view = async (item: LiveSession) => { try { const data = await apiRequest<Summary>(`/learner/sessions/${item.id}/summary`, { roleCode: session.roleCode }); setSummaries((current) => ({ ...current, [item.id]: data })); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được chi tiết buổi học.", "error"); } };
  if (session.roleCode !== "LEARNER") return <AccessDenied />;
  return <div className="mx-auto max-w-5xl px-5 py-8 md:px-8 md:py-10"><PageHeader eyebrow="My Learning Record" title="Lịch sử học tập" description="Theo dõi thời lượng tham dự, trạng thái điểm danh và bản ghi được cấp quyền." /><div className="space-y-4">{items.map((item) => { const summary = summaries[item.id]; return <article className="rounded-2xl border border-slate-200 bg-white p-5" key={item.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><History className="text-sky-700" size={18} /><h2 className="font-heading text-lg font-extrabold">{item.title}</h2><StatusBadge status={item.status} /></div><p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Clock3 size={13} />{new Date(item.startsAt).toLocaleString("vi-VN")}</p></div><Button onClick={() => void view(item)} variant="secondary">Xem điểm danh</Button></div>{summary ? <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-2xl font-extrabold">{summary.attendance.attendedMinutes}&apos;</p><p className="text-xs text-slate-500">Thời lượng tham dự</p></div><div className="rounded-xl bg-slate-50 p-4"><StatusBadge status={summary.attendance.status} /><p className="mt-2 text-xs text-slate-500">Trạng thái điểm danh</p></div><div className="rounded-xl bg-slate-50 p-4">{summary.session.recordingUrl ? <a className="inline-flex items-center gap-2 text-sm font-bold text-sky-700" href={summary.session.recordingUrl} rel="noreferrer" target="_blank"><Video size={16} />Xem bản ghi<ExternalLink size={13} /></a> : <p className="text-sm text-slate-400">Bản ghi chưa sẵn sàng</p>}</div></div> : null}</article>; })}</div></div>;
}
