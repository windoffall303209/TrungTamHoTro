"use client";
import { usePagination } from "@/components/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import type {
  ClassCapabilities,
  ClassClosureReadiness,
  ClassRoster,
  Course,
  EnrollmentImportResult,
  InstructorRole,
  LearningClass,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailTab, RemoveTarget, roleLabel } from "./class-detail.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình chi tiết lớp; giữ nguyên thứ tự hook. */
export function useClassDetailModel() {
  const params = useParams<{ classId: string }>();

  const router = useRouter();

  const { session, notify } = useApp();

  const classId = params.classId;

  const allowed = [
    "SYSTEM_ADMIN",
    "CENTER_MANAGER",
    "INSTRUCTOR",
    "LEARNER",
  ].includes(session.roleCode);

  const baseCanManage =
    ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) &&
    hasPermission(session, "class:manage");

  const [capabilities, setCapabilities] = useState<ClassCapabilities | null>(
    null,
  );

  const canManage =
    baseCanManage && (capabilities?.actions.manageRoster.allowed ?? true);

  const [item, setItem] = useState<LearningClass | null>(null);

  const [course, setCourse] = useState<Course | null>(null);

  const [roster, setRoster] = useState<ClassRoster | null>(null);

  const [readiness, setReadiness] = useState<ClassClosureReadiness | null>(
    null,
  );

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [instructorForm, setInstructorForm] = useState({
    userId: "",
    role: "PRIMARY" as InstructorRole,
  });

  const [learnerId, setLearnerId] = useState("");

  const [bulkLearners, setBulkLearners] = useState("");

  const [importResults, setImportResults] = useState<EnrollmentImportResult[]>(
    [],
  );

  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

  const [removeReason, setRemoveReason] = useState("");

  const [transferTarget, setTransferTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [transferReason, setTransferReason] = useState("");

  const activeEnrollments = useMemo(
    () =>
      roster?.enrollments.filter(
        (enrollment) => enrollment.status === "ACTIVE",
      ) ?? [],
    [roster],
  );

  const instructors = useMemo(
    () =>
      roster?.instructors ??
      item?.instructorIds.map((instructorId) => ({
        instructorId,
        role: "CO_INSTRUCTOR" as InstructorRole,
        assignedAt: "",
        displayName: undefined,
        email: undefined,
      })) ??
      [],
    [item?.instructorIds, roster?.instructors],
  );

  const primaryInstructor = instructors.find(
    (instructor) => instructor.role === "PRIMARY",
  );

  const learnerPagination = usePagination(activeEnrollments);

  const historyPagination = usePagination(roster?.history ?? []);

  /** Nạp song song chi tiết lớp, roster và danh sách người dùng có thể được thêm. */
  const load = useCallback(async () => {
    if (!allowed || !classId) return;
    setLoading(true);
    try {
      const [classData, capabilityData] = await Promise.all([
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        apiRequest<ClassCapabilities>(`/classes/${classId}/capabilities`, {
          roleCode: session.roleCode,
        }),
      ]);
      setCapabilities(capabilityData);
      const selected =
        classData.find((candidate) => candidate.id === classId) ?? null;
      setItem(selected);
      if (!selected) return;

      if (canManage) {
        const [rosterData, readinessData, courses] = await Promise.all([
          apiRequest<ClassRoster>(`/manager/classes/${classId}/roster`, {
            roleCode: session.roleCode,
          }),
          apiRequest<ClassClosureReadiness>(
            `/manager/classes/${classId}/closure-readiness`,
            { roleCode: session.roleCode },
          ),
          apiRequest<Course[]>("/manager/courses", {
            roleCode: session.roleCode,
          }),
        ]);
        setRoster(rosterData);
        setReadiness(readinessData);
        setCourse(
          courses.find((candidate) => candidate.id === selected.courseId) ??
            null,
        );
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được hồ sơ lớp.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, canManage, classId, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Phân công giảng viên với vai trò PRIMARY hoặc CO_INSTRUCTOR đúng hợp đồng API. */
  const assignInstructor = async () => {
    if (!item || !instructorForm.userId) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/instructors`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          userId: instructorForm.userId,
          role: instructorForm.role,
        }),
      });
      notify(`Đã phân công ${roleLabel[instructorForm.role].toLowerCase()}.`);
      setInstructorForm({ ...instructorForm, userId: "" });
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không phân công được giảng viên.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Bàn giao vai trò giảng viên chính cho đồng giảng viên đã chọn trong một lệnh nguyên tử. */
  const transferPrimary = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!item || !primaryInstructor || !transferTarget) return;
    setSaving(true);
    try {
      await apiRequest(
        `/manager/classes/${item.id}/instructors/transfer-primary`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            expectedPrimaryId: primaryInstructor.instructorId,
            newPrimaryId: transferTarget.id,
            reason: transferReason.trim(),
          }),
        },
      );
      notify("Đã bàn giao giảng viên chính và lưu lịch sử hai bên.");
      setTransferTarget(null);
      setTransferReason("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không bàn giao được giảng viên chính.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Ghi danh một học viên vào lớp và làm mới dữ liệu sau khi thành công. */
  const enrollLearner = async () => {
    if (!item || !learnerId) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/enrollments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ userId: learnerId }),
      });
      notify("Đã ghi danh học viên vào lớp.");
      setLearnerId("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không ghi danh được học viên.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Ghi danh hàng loạt và giữ kết quả từng tài khoản để người quản lý đối soát. */
  const importEnrollments = async () => {
    if (!item) return;
    const userIds = bulkLearners
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!userIds.length) {
      notify("Nhập ít nhất một email hoặc mã học viên.", "error");
      return;
    }
    setSaving(true);
    try {
      const results = await apiRequest<EnrollmentImportResult[]>(
        `/manager/classes/${item.id}/enrollments/import`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ userIds }),
        },
      );
      setImportResults(results);
      setBulkLearners("");
      notify(`Đã xử lý ${results.length} dòng ghi danh.`);
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không nhập được danh sách học viên.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Xác nhận rồi gỡ giảng viên hoặc học viên đã chọn khỏi lớp. */
  const removeMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!item || !removeTarget) return;
    setSaving(true);
    try {
      await apiRequest(
        `/manager/classes/${item.id}/${removeTarget.kind}/${removeTarget.id}/remove`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({ reason: removeReason.trim() }),
        },
      );
      notify("Đã cập nhật thành viên và lưu lịch sử thay đổi.");
      setRemoveTarget(null);
      setRemoveReason("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gỡ được thành viên.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Chuyển lớp sang trạng thái hoạt động sau kiểm tra điều kiện ở máy chủ. */
  const activate = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${item.id}/activate`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã kích hoạt lớp học.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không kích hoạt được lớp.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };
  return {
    router,
    session,
    classId,
    allowed,
    canManage,
    item,
    course,
    roster,
    readiness,
    activeTab,
    setActiveTab,
    loading,
    saving,
    instructorForm,
    setInstructorForm,
    learnerId,
    setLearnerId,
    bulkLearners,
    setBulkLearners,
    importResults,
    removeTarget,
    setRemoveTarget,
    removeReason,
    setRemoveReason,
    transferTarget,
    setTransferTarget,
    transferReason,
    setTransferReason,
    activeEnrollments,
    instructors,
    primaryInstructor,
    learnerPagination,
    historyPagination,
    assignInstructor,
    transferPrimary,
    enrollLearner,
    importEnrollments,
    removeMember,
    activate,
  };
}
