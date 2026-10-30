import pg from 'pg';

/** Đảm nhiệm seedK12 trong phạm vi module hiện tại. */
async function seedK12() {
  const client = new pg.Client({
    connectionString: 'postgresql://postgres:admin@localhost:5432/trung_tam_giang_day'
  });
  await client.connect();

  console.log('Đang cập nhật phân cấp Khối - Môn - Lớp cho database...');

  // Cập nhật các khóa học và lớp học hiện hữu
  await client.query(`
    UPDATE courses SET grade = 10, subject = 'Tin học' WHERE id IN ('course-data', 'demo-course-03');
    UPDATE courses SET grade = 11, subject = 'Tin học' WHERE id IN ('course-web', 'demo-course-05', 'demo-course-07');
    UPDATE courses SET grade = 12, subject = 'Tin học' WHERE id IN ('demo-course-04', 'demo-course-06', 'demo-course-08');
    
    UPDATE learning_classes c
    SET grade = crs.grade, subject = crs.subject
    FROM courses crs
    WHERE c.course_id = crs.id;
  `);

  // Thêm các môn K-12 như Toán, Ngữ văn, Tiếng Anh, Vật lí
  await client.query(`
    INSERT INTO courses (id, code, name, description, outcomes, status, version, owner_id, grade, subject, created_at, updated_at)
    VALUES 
    ('crs-math-06', 'MATH-06', 'Toán học 6 (Kết nối tri thức)', 'Chương trình toán học lớp 6 chuẩn Bộ GD&ĐT', '["Nắm vững số tự nhiên", "Hình học cơ bản"]', 'PUBLISHED', 1, 'usr-manager', 6, 'Toán', NOW(), NOW()),
    ('crs-lit-06', 'LIT-06', 'Ngữ văn 6', 'Chương trình ngữ văn 6 bài bản', '["Đọc hiểu văn bản", "Kỹ năng viết"]', 'PUBLISHED', 1, 'usr-manager', 6, 'Ngữ văn', NOW(), NOW()),
    ('crs-eng-06', 'ENG-06', 'Tiếng Anh 6 - Global Success', 'Tiếng Anh giao tiếp và ngữ pháp lớp 6', '["Giao tiếp cơ bản", "Từ vựng theo chủ điểm"]', 'PUBLISHED', 1, 'usr-manager', 6, 'Tiếng Anh', NOW(), NOW()),
    ('crs-math-10', 'MATH-10', 'Toán học 10', 'Đại số và hình học không gian lớp 10', '["Hàm số bậc hai", "Vectơ trong mặt phẳng"]', 'PUBLISHED', 1, 'usr-manager', 10, 'Toán', NOW(), NOW()),
    ('crs-phy-10', 'PHY-10', 'Vật lí 10', 'Cơ học và chuyển động lớp 10', '["Động học chất điểm", "Động lực học chất điểm"]', 'PUBLISHED', 1, 'usr-manager', 10, 'Vật lí', NOW(), NOW())
    ON CONFLICT (code) DO UPDATE SET grade = EXCLUDED.grade, subject = EXCLUDED.subject;
  `);

  // Thêm các lớp học K-12 tương ứng
  await client.query(`
    INSERT INTO learning_classes (id, course_id, course_version, code, name, term, grade, subject, start_at, end_at, capacity, timezone, allow_late_enrollment, status, created_at, updated_at)
    VALUES 
    ('cls-toan-6a1', 'crs-math-06', 1, 'TOAN-6A1', 'Lớp Toán 6A1 (Nâng cao)', '2026-2027', 6, 'Toán', '2026-09-01', '2027-05-31', 40, 'Asia/Bangkok', false, 'ACTIVE', NOW(), NOW()),
    ('cls-toan-6a2', 'crs-math-06', 1, 'TOAN-6A2', 'Lớp Toán 6A2 (Cơ bản)', '2026-2027', 6, 'Toán', '2026-09-01', '2027-05-31', 40, 'Asia/Bangkok', false, 'ACTIVE', NOW(), NOW()),
    ('cls-van-6a1', 'crs-lit-06', 1, 'VAN-6A1', 'Lớp Ngữ văn 6A1', '2026-2027', 6, 'Ngữ văn', '2026-09-01', '2027-05-31', 35, 'Asia/Bangkok', false, 'ACTIVE', NOW(), NOW()),
    ('cls-toan-10a1', 'crs-math-10', 1, 'TOAN-10A1', 'Lớp Toán 10A1 (Chuyên Toán)', '2026-2027', 10, 'Toán', '2026-09-01', '2027-05-31', 40, 'Asia/Bangkok', false, 'ACTIVE', NOW(), NOW()),
    ('cls-phy-10a1', 'crs-phy-10', 1, 'LY-10A1', 'Lớp Vật lí 10A1', '2026-2027', 10, 'Vật lí', '2026-09-01', '2027-05-31', 38, 'Asia/Bangkok', false, 'ACTIVE', NOW(), NOW())
    ON CONFLICT (code, term) DO UPDATE SET grade = EXCLUDED.grade, subject = EXCLUDED.subject;
  `);

  console.log('Đã cập nhật thành công dữ liệu mẫu K-12!');
  await client.end();
}

seedK12().catch(console.error);
