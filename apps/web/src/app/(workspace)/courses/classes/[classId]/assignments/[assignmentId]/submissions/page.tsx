"use client";

import { useParams, useSearchParams } from "next/navigation";
import { AssignmentSubmissionReviewScreen } from "@/roles/instructor/class/assignment-submission-review-screen";

/** Điểm vào trang xem và chấm bài làm tự luận chi tiết của một lớp học. */
export default function AssignmentSubmissionsReviewPage() {
  const params = useParams<{ classId: string; assignmentId: string }>();
  const searchParams = useSearchParams();
  return (
    <AssignmentSubmissionReviewScreen
      classId={params.classId}
      assignmentId={params.assignmentId}
      initialSubmissionId={searchParams.get("submissionId")}
    />
  );
}
