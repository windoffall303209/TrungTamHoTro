-- Phạm vi học liệu: SHARED cho mọi học viên tra cứu, CLASS chỉ dành cho học viên của lớp.
CREATE TYPE "MaterialScope" AS ENUM ('SHARED', 'CLASS');

-- Học liệu đang có giữ phạm vi lớp như trước; học liệu mới mặc định dùng chung.
ALTER TABLE "materials" ADD COLUMN "scope" "MaterialScope" NOT NULL DEFAULT 'CLASS';
ALTER TABLE "materials" ALTER COLUMN "scope" SET DEFAULT 'SHARED';
