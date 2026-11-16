-- DropForeignKey
ALTER TABLE "ai_study_drafts" DROP CONSTRAINT IF EXISTS "ai_study_drafts_material_id_source_version_fkey";

-- Clean orphan drafts if any before rebinding FK directly to materials
DELETE FROM "ai_study_drafts" a
WHERE NOT EXISTS (SELECT 1 FROM "materials" m WHERE m."id" = a."material_id");

-- AddForeignKey
ALTER TABLE "ai_study_drafts" ADD CONSTRAINT "ai_study_drafts_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_study_drafts_material_id_source_version_idx" ON "ai_study_drafts"("material_id", "source_version");

-- DropTable
DROP TABLE IF EXISTS "class_instructor_history";
DROP TABLE IF EXISTS "class_enrollment_history";
DROP TABLE IF EXISTS "material_versions";
DROP TABLE IF EXISTS "material_access_logs";
