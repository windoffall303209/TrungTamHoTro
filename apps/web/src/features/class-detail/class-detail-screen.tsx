"use client";

import { AccessDenied } from "@/components/access-denied";
import { SectionState } from "@/components/section-state";
import { useClassDetailModel } from "./use-class-detail-model";
import { LearnerClassWorkspace } from "@/features/learner-class/learner-class-workspace";
import { InstructorClassWorkspace } from "@/features/instructor-class/instructor-class-workspace";
import { ManagerClassWorkspace } from "@/features/operations/manager-class-workspace";

/** Lắp ghép màn hình chi tiết lớp theo từng vai trò người dùng (Learner, Instructor, Manager). */
export default function ClassDetailScreen() {
  const model = useClassDetailModel();
  const {
    router,
    session,
    allowed,
    item,
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
    historyPagination,
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
        session.roleCode === "LEARNER" ? (
          <LearnerClassWorkspace
            item={item}
            course={course}
            teacherName={primaryInstructor?.displayName || "Giảng viên phụ trách"}
            instructors={instructors}
            onBack={() => router.push("/courses")}
          />
        ) : session.roleCode === "INSTRUCTOR" ? (
          <InstructorClassWorkspace
            item={item}
            course={course}
            instructors={instructors}
            onBack={() => router.push("/courses")}
          />
        ) : (
          <ManagerClassWorkspace
            item={item}
            course={course}
            roster={roster}
            readiness={readiness}
            saving={saving}
            onBack={() => router.push("/courses")}
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
            historyPagination={historyPagination}
            assignInstructor={assignInstructor}
            transferPrimary={transferPrimary}
            enrollLearner={enrollLearner}
            importEnrollments={importEnrollments}
            removeMember={removeMember}
            activate={activate}
          />
        )
      ) : null}
    </SectionState>
  );
}
