import { WorkspaceShell } from "@/components/workspace-shell";
import { AuthGate } from "@/components/auth-gate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate><WorkspaceShell>{children}</WorkspaceShell></AuthGate>;
}
