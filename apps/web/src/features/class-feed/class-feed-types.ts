import type {
  ClassFeedAttachment,
  ClassFeedAuthorRole,
  ClassFeedComment,
  ClassFeedEditHistory,
  ClassFeedLikeToggleResult,
  ClassFeedPost,
  ClassFeedPreferenceResult,
} from "@/lib/learning-types";

export type {
  ClassFeedAttachment,
  ClassFeedAuthorRole,
  ClassFeedComment,
  ClassFeedEditHistory,
  ClassFeedLikeToggleResult,
  ClassFeedPost,
  ClassFeedPreferenceResult,
};

export interface ClassFeedViewProps {
  classItem: {
    id: string;
    name?: string;
    code: string;
    status?: string;
    allowLearnerFeedPosting?: boolean;
  };
  courseName?: string;
  teacherName?: string;
}
