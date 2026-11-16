-- Kiểm tra và gán duy nhất lớp học cho các học liệu có class_id = NULL trước khi ép buộc NOT NULL;
-- đồng thời chuẩn hóa class_folders, scope = 'CLASS' và xóa bỏ bảng phân quyền material_editors.
DO $$
DECLARE
  v_unresolved_count INTEGER := 0;
  v_unresolved_report TEXT := '';
BEGIN
  WITH null_materials AS (
    SELECT
      m.id,
      m.name,
      m.course_id,
      m.owner_id,
      m.folder,
      m.mime_type,
      m.tags,
      m.created_at,
      ARRAY(
        SELECT DISTINCT ref.class_id
        FROM (
          SELECT ft.class_id
          FROM forum_post_attachments fpa
          JOIN forum_posts fp ON fp.id = fpa.post_id
          JOIN forum_topics ft ON ft.id = fp.topic_id
          JOIN learning_classes lc ON lc.id = ft.class_id
          WHERE fpa.material_id = m.id
            AND lc.course_id = m.course_id
          UNION
          SELECT a.class_id
          FROM assignments a
          JOIN learning_classes lc ON lc.id = a.class_id
          WHERE a.source_material_id = m.id
            AND lc.course_id = m.course_id
        ) AS ref
        ORDER BY ref.class_id
      ) AS ref_class_ids,
      ARRAY(
        SELECT lc.id
        FROM learning_classes lc
        WHERE lc.course_id = m.course_id
        ORDER BY lc.id
      ) AS course_class_ids,
      ARRAY(
        SELECT DISTINCT lc.id
        FROM learning_classes lc
        JOIN class_instructors ci ON ci.class_id = lc.id
        WHERE lc.course_id = m.course_id
          AND ci.instructor_id = m.owner_id
        ORDER BY lc.id
      ) AS owner_course_class_ids
    FROM materials m
    WHERE m.class_id IS NULL
  ),
  resolved AS (
    SELECT
      nm.id,
      nm.name,
      nm.course_id,
      nm.owner_id,
      nm.created_at,
      CASE
        WHEN COALESCE(array_length(nm.ref_class_ids, 1), 0) = 1 THEN nm.ref_class_ids[1]
        WHEN COALESCE(array_length(nm.ref_class_ids, 1), 0) > 1 THEN NULL
        WHEN COALESCE(array_length(nm.course_class_ids, 1), 0) = 1 THEN nm.course_class_ids[1]
        WHEN COALESCE(array_length(nm.owner_course_class_ids, 1), 0) = 1 THEN nm.owner_course_class_ids[1]
        ELSE NULL
      END AS resolved_class_id,
      CASE
        WHEN COALESCE(array_length(nm.ref_class_ids, 1), 0) > 1
          THEN 'Có >= 2 lớp tham chiếu trực tiếp (' || array_to_string(nm.ref_class_ids, ', ') || ')'
        WHEN COALESCE(array_length(nm.course_class_ids, 1), 0) = 0
          THEN 'Khóa học chưa có lớp học nào để ánh xạ'
        WHEN COALESCE(array_length(nm.owner_course_class_ids, 1), 0) = 0
          THEN 'Khóa học có ' || array_length(nm.course_class_ids, 1) || ' lớp (' || array_to_string(nm.course_class_ids, ', ') || ') và owner_id không được phân công trong lớp nào của khóa học'
        ELSE 'Khóa học có nhiều lớp và owner_id được phân công ở ' || array_length(nm.owner_course_class_ids, 1) || ' lớp (' || array_to_string(nm.owner_course_class_ids, ', ') || ')'
      END AS unresolved_reason
    FROM null_materials nm
  ),
  unresolved AS (
    SELECT * FROM resolved WHERE resolved_class_id IS NULL
  )
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(
      string_agg(
        format('[id=%s, name=%L, course_id=%s, owner_id=%s, ly_do=%s]', u.id, u.name, u.course_id, u.owner_id, u.unresolved_reason),
        E'\n'
        ORDER BY u.created_at ASC, u.id ASC
      ),
      ''
    )
  INTO v_unresolved_count, v_unresolved_report
  FROM unresolved u;

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'Dừng migration: có % học liệu có class_id = NULL không thể xác định duy nhất một lớp học để tự gán (không xóa tệp hay gán tùy ý). Danh sách bản ghi cần xử lý thủ công:% %',
      v_unresolved_count,
      E'\n',
      v_unresolved_report;
  END IF;

  -- Chỉ tự gán khi 100% bản ghi class_id IS NULL đã được xác định duy nhất.
  WITH null_materials AS (
    SELECT
      m.id,
      m.course_id,
      m.owner_id,
      ARRAY(
        SELECT DISTINCT ref.class_id
        FROM (
          SELECT ft.class_id
          FROM forum_post_attachments fpa
          JOIN forum_posts fp ON fp.id = fpa.post_id
          JOIN forum_topics ft ON ft.id = fp.topic_id
          JOIN learning_classes lc ON lc.id = ft.class_id
          WHERE fpa.material_id = m.id
            AND lc.course_id = m.course_id
          UNION
          SELECT a.class_id
          FROM assignments a
          JOIN learning_classes lc ON lc.id = a.class_id
          WHERE a.source_material_id = m.id
            AND lc.course_id = m.course_id
        ) AS ref
        ORDER BY ref.class_id
      ) AS ref_class_ids,
      ARRAY(
        SELECT lc.id
        FROM learning_classes lc
        WHERE lc.course_id = m.course_id
        ORDER BY lc.id
      ) AS course_class_ids,
      ARRAY(
        SELECT DISTINCT lc.id
        FROM learning_classes lc
        JOIN class_instructors ci ON ci.class_id = lc.id
        WHERE lc.course_id = m.course_id
          AND ci.instructor_id = m.owner_id
        ORDER BY lc.id
      ) AS owner_course_class_ids
    FROM materials m
    WHERE m.class_id IS NULL
  ),
  resolved AS (
    SELECT
      nm.id,
      CASE
        WHEN COALESCE(array_length(nm.ref_class_ids, 1), 0) = 1 THEN nm.ref_class_ids[1]
        WHEN COALESCE(array_length(nm.course_class_ids, 1), 0) = 1 THEN nm.course_class_ids[1]
        WHEN COALESCE(array_length(nm.owner_course_class_ids, 1), 0) = 1 THEN nm.owner_course_class_ids[1]
        ELSE NULL
      END AS resolved_class_id
    FROM null_materials nm
  )
  UPDATE materials m
  SET
    class_id = r.resolved_class_id,
    scope = 'CLASS'
  FROM resolved r
  WHERE m.id = r.id
    AND r.resolved_class_id IS NOT NULL;
END $$;

-- Đưa toàn bộ học liệu hiện hữu về phạm vi lớp học.
UPDATE "materials"
SET "scope" = 'CLASS'
WHERE "scope" <> 'CLASS';

-- Đảm bảo mọi thư mục đang được học liệu sử dụng đều tồn tại trong class_folders.
INSERT INTO "class_folders" ("class_id", "kind", "name")
SELECT DISTINCT
  m."class_id",
  CASE
    WHEN m."mime_type" ~ '^(audio|video)/'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(m."tags") = 'array' THEN m."tags" ELSE '[]'::jsonb END
        ) AS tag
        WHERE tag ~* 'lecture|video|bài giảng'
      )
    THEN 'lectures'
    ELSE 'materials'
  END AS "kind",
  trim(m."folder") AS "name"
FROM "materials" m
WHERE m."class_id" IS NOT NULL
  AND length(trim(m."folder")) > 0
ON CONFLICT ("class_id", "kind", "name") DO NOTHING;

-- Đảm bảo các lớp hiện có đều có bộ thư mục nền tảng một cấp trong class_folders.
INSERT INTO "class_folders" ("class_id", "kind", "name")
SELECT lc."id", f."kind", f."name"
FROM "learning_classes" lc
CROSS JOIN (
  VALUES
    ('materials'::varchar(16), 'Tài liệu chung'::varchar(255)),
    ('materials'::varchar(16), 'Tài liệu'::varchar(255)),
    ('materials'::varchar(16), 'Bài tập tự luận'::varchar(255)),
    ('lectures'::varchar(16), 'Bài giảng chung'::varchar(255)),
    ('lectures'::varchar(16), 'Bài giảng'::varchar(255))
) AS f("kind", "name")
ON CONFLICT ("class_id", "kind", "name") DO NOTHING;

-- Bắt buộc class_id và loại bỏ bảng phân quyền sửa học liệu riêng lẻ.
ALTER TABLE "materials" ALTER COLUMN "class_id" SET NOT NULL;
ALTER TABLE "materials" ALTER COLUMN "scope" SET DEFAULT 'CLASS';
DROP TABLE IF EXISTS "material_editors";
