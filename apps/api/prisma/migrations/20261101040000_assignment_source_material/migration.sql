-- Store a real class material attachment for essay assignments.
ALTER TABLE "assignments" ADD COLUMN "source_material_id" TEXT;
CREATE INDEX "assignments_source_material_id_idx" ON "assignments"("source_material_id");
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_source_material_id_fkey" FOREIGN KEY ("source_material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
