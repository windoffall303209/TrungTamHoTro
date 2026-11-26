"use client";

import { lazy, Suspense } from "react";
import { AccessDenied } from "@/shared/auth/access-denied";
import { SectionState } from "@/shared/ui/section-state";
import { useClassDetailModel } from "./use-class-detail-model";

const LazyLearnerClassWorkspace = lazy(() =>
  import("@/roles/learner/class/learner-class-workspace").then((mod) => ({
    default: mod.LearnerClassWorkspace,
  })),
);
const LazyInstructorClassWorkspace = lazy(() =>
  import("@/roles/instructor/class/instructor-class-workspace").then((mod) => ({
    default: mod.InstructorClassWorkspace,
  })),
);
const LazyManagerClassWorkspace = lazy(() =>
  import("@/roles/manager/manager-class-workspace").then((mod) => ({
    default: mod.ManagerClassWorkspace,
  })),
);

/** Lắp ghép màn hình chi tiết lớp theo đúng vai trò bằng chunk nạp lười riêng từng vai trò. */
export default function ClassDetailScreen() {
  const model = useClassDetailModel();
  const {
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
    assignInstructor,
    transferPrimary,
    enrollLearner,
    importEnrollments,
    removeMember,
    activate,
  } = model;

  if (!allowed) return <AccessDenied />;

  return (
    <SectionState loading={loading} empty={!item}>
      {item ? (
        <Suspense fallback={<SectionState loading empty={false}>{null}</SectionState>}>
          {session.roleCode === "LEARNER" ? (
            <LazyLearnerClassWorkspace
              item={item}
              course={course}
              teacherName={primaryInstructor?.displayName || "Giảng viên phụ trách"}
              instructors={instructors}
              onBack={() => router.push("/courses")}
            />
          ) : session.roleCode === "INSTRUCTOR" ? (
            <LazyInstructorClassWorkspace
              item={item}
              course={course}
              instructors={instructors}
              onBack={() => router.push("/courses")}
              onClassUpdated={setItem}
            />
          ) : (
            <LazyManagerClassWorkspace
              item={item}
              course={course}
              roster={roster}
              readiness={readiness}
              saving={saving}
              onBack={() => router.push("/courses")}
              onClassUpdated={setItem}
              instructorForm={instructorForm}
              setInstructorForm={setInstructorForm}
              learnerId={learnerId}
              setLearnerId={setLearnerId}
              bulkLearners={bulkLearners}
              setBulkLearners={setBulkLearners}
              importResults={importResults}
              removeTarget={removeTarget}
              setRemoveTarget={setRemoveTarget}
              removeReason={removeReason}
              setRemoveReason={setRemoveReason}
              transferTarget={transferTarget}
              setTransferTarget={setTransferTarget}
              transferReason={transferReason}
              setTransferReason={setTransferReason}
              activeEnrollments={activeEnrollments}
              instructors={instructors}
              primaryInstructor={primaryInstructor}
              learnerPagination={learnerPagination}
              assignInstructor={assignInstructor}
              transferPrimary={transferPrimary}
              enrollLearner={enrollLearner}
              importEnrollments={importEnrollments}
              removeMember={removeMember}
              activate={activate}
            />
          )}
        </Suspense>
      ) : null}
    </SectionState>
  );
}
