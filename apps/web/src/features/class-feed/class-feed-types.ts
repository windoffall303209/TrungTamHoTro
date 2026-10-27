export interface PostComment {
  id: string;
  authorName: string;
  authorAvatar?: string;
  authorAvatarUrl?: string | null;
  authorRole?: string;
  createdAt: string;
  content: string;
  likes: number;
  isLiked?: boolean;
  isEdited?: boolean;
  replyTo?: string; // Tên của người được nhắc đến trong câu trả lời
  replies?: PostComment[]; // Danh sách các bình luận con cấp 2 (thụt lề theo thread)
}

export interface ClassPost {
  id: string;
  authorName: string;
  authorAvatar?: string;
  authorAvatarUrl?: string | null;
  authorRole: string;
  createdAt: string;
  content: string;
  images?: string[];
  likes: number;
  isLiked?: boolean;
  isEdited?: boolean;
  comments: PostComment[];
}

export interface ClassFeedViewProps {
  classItem: {
    id: string;
    name?: string;
    code: string;
  };
  courseName?: string;
  teacherName?: string;
}
