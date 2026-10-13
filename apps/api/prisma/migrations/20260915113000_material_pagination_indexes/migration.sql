-- Support stable, scoped material pagination without sorting an entire class/course history.
CREATE INDEX "materials_class_id_created_at_id_idx" ON "materials" ("class_id", "created_at" DESC, "id");
CREATE INDEX "materials_course_id_created_at_id_idx" ON "materials" ("course_id", "created_at" DESC, "id");
