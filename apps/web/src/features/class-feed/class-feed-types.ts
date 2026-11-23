/** Thông báo lớp do máy chủ trả về (bảng class_announcements). */
export interface ClassAnnouncement {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  body: string;
  authorName: string;
  publishedAt: string;
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
