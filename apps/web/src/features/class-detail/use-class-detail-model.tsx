"use client";
import { usePagination } from "@/shared/ui/ui";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemoveTarget, roleLabel } from "./class-detail.shared";

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

  const [item, setItem] = useState<LearningClass | null>(null);

  const course: Course | null = null;

  const [roster, setRoster] = useState<ClassRoster | null>(null);

  const readiness: ClassClosureReadiness | null = null;

  const [loading, setLoading] = useState(true);
  const loadRequestId = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

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

  const [transferTarget, setTransferTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

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


  /** Nạp song song hồ sơ đúng một lớp, capability và roster quản trị (<= 3 request, không tải danh sách toàn cục). */
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    if (!allowed || !classId) return;
    setLoading(true);
    try {
      const encodedClassId = encodeURIComponent(classId);
      const classPromise = apiRequest<LearningClass>(`/classes/${encodedClassId}`, {
        roleCode: session.roleCode,
        signal: controller.signal,
      });
      const capabilityPromise = apiRequest<ClassCapabilities>(
        `/classes/${encodedClassId}/capabilities`,
        {
          roleCode: session.roleCode,
          signal: controller.signal,
        },
      );
      const rosterPromise = baseCanManage
        ? apiRequest<ClassRoster>(`/manager/classes/${encodedClassId}/roster`, {
            roleCode: session.roleCode,
            signal: controller.signal,
          }).catch(() => null)
        : Promise.resolve<ClassRoster | null>(null);

      const [selected, capabilityData, rosterData] = await Promise.all([
        classPromise,
        capabilityPromise,
        rosterPromise,
      ]);
      if (requestId !== loadRequestId.current || controller.signal.aborted) return;
      setItem(selected ?? null);
      if (baseCanManage && (capabilityData?.actions.manageRoster.allowed ?? true)) {
        setRoster(rosterData);
      } else {
        setRoster(null);
      }
    } catch (error) {
      if (requestId === loadRequestId.current && !controller.signal.aborted) {
        notify(
          error instanceof Error ? error.message : "Không tải được hồ sơ lớp.",
          "error",
        );
      }
    } finally {
      if (requestId === loadRequestId.current && !controller.signal.aborted) setLoading(false);
    }
  }, [allowed, baseCanManage, classId, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestId.current += 1;
      loadControllerRef.current?.abort();
    };
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
          }),
        },
      );
      notify("Đã bàn giao giảng viên chính và lưu lịch sử hai bên.");
      setTransferTarget(null);
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
          body: JSON.stringify({}),
        },
      );
      notify("Đã cập nhật thành viên và lưu lịch sử thay đổi.");
      setRemoveTarget(null);
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
    allowed,
    item,
    setItem,
    course,
    roster,
    readiness,
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
    transferTarget,
    setTransferTarget,
    activeEnrollments,
    instructors,
    primaryInstructor,
    learnerPagination,
    assignInstructor,
    transferPrimary,
    enrollLearner,
    importEnrollments,
    removeMember,
    activate,
  };
}
