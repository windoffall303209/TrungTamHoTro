"use client";

import { GraduationCap, LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/providers/app-provider";
import { RequestError } from "@/shared/ui/request-error";

/** Chờ khôi phục phiên và chuyển người chưa đăng nhập về login kèm đường dẫn quay lại. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, authLoading, authError, refreshSession } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authLoading && !authError && !authenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [authenticated, authLoading, authError, pathname, router]);

  if (!authLoading && authError) return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] p-5"><RequestError message={authError} retry={() => void refreshSession()} /></main>;

  if (authLoading || !authenticated) return <div className="grid min-h-screen place-items-center bg-[var(--canvas)] text-[var(--ink)]"><div className="text-center"><GraduationCap className="mx-auto text-[var(--accent)]" size={34} /><p className="mt-4 flex items-center gap-2 text-sm font-bold"><LoaderCircle className="animate-spin" size={17} />Đang kiểm tra phiên làm việc…</p></div></div>;
  return children;
}
