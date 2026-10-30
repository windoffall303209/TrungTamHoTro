import { WorkspaceShell } from "@/shared/layout/workspace-shell";
import { AuthGate } from "@/shared/auth/auth-gate";

/** Bọc mọi trang nghiệp vụ bằng kiểm tra phiên và shell điều hướng dùng chung. */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate><WorkspaceShell>{children}</WorkspaceShell></AuthGate>;
}
