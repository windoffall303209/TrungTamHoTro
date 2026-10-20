-- Học liệu dùng chung theo môn học không cần thuộc lớp nào.
ALTER TABLE "materials" ALTER COLUMN "class_id" DROP NOT NULL;

-- Giảng viên được người tải lên cấp quyền sửa học liệu.
CREATE TABLE "material_editors" (
    "material_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" VARCHAR(191) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_editors_pkey" PRIMARY KEY ("material_id","user_id")
);

CREATE INDEX "material_editors_user_id_idx" ON "material_editors"("user_id");

ALTER TABLE "material_editors" ADD CONSTRAINT "material_editors_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_editors" ADD CONSTRAINT "material_editors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
