"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { Course } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

/** Hiển thị danh sách khóa học để chuyển phạm vi của ngân hàng câu hỏi. */
export function QuestionBankLayout({ children }: { children: React.ReactNode }) {
  const { session } = useApp();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedCourseId = searchParams.get("courseId") ?? "";
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode })
      .then((items) => { if (!cancelled) setCourses(items); })
      .catch(() => { if (!cancelled) setCourses([]); });
    return () => { cancelled = true; };
  }, [session.roleCode]);

  return (
    <div className="w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <aside className="w-full shrink-0 lg:sticky lg:top-[85px] lg:w-64">
          <div className="space-y-1 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/90">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">Khóa học</div>
            <nav aria-label="Phạm vi khóa học của ngân hàng câu hỏi" className="space-y-1">
              <Link
                aria-current={!selectedCourseId ? "page" : undefined}
                className={`block w-full rounded-xl border px-3.5 py-3 text-left text-xs font-bold transition-all sm:text-sm ${!selectedCourseId ? "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/60 dark:text-sky-300" : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"}`}
                href={pathname}
              >
                Tất cả
                <span className="mt-1 block text-[10px] font-normal text-slate-500">Toàn bộ ngân hàng câu hỏi</span>
              </Link>
              {courses.map((course) => {
                const active = selectedCourseId === course.id;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`block w-full rounded-xl border px-3.5 py-3 text-left text-xs font-bold transition-all sm:text-sm ${active ? "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/60 dark:text-sky-300" : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"}`}
                    href={`${pathname}?courseId=${encodeURIComponent(course.id)}`}
                    key={course.id}
                  >
                    <span className="block truncate">{course.code} — {course.name}</span>
                    <span className="mt-1 block text-[10px] font-normal text-slate-500">Chỉ câu hỏi của khóa này</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>
        <main className="min-w-0 w-full flex-1">{children}</main>
      </div>
    </div>
  );
}
