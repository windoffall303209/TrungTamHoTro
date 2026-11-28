BEGIN;
ALTER TABLE assignments ADD COLUMN hidden boolean NOT NULL DEFAULT false;
CREATE TABLE class_folders (
  class_id text NOT NULL REFERENCES learning_classes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind varchar(16) NOT NULL CHECK (kind IN ('lectures','materials','assignments')),
  name varchar(255) NOT NULL CHECK (length(trim(name)) > 0),
  PRIMARY KEY (class_id, kind, name)
);
INSERT INTO class_folders SELECT DISTINCT class_id, CASE WHEN tags ? 'LECTURE' THEN 'lectures' ELSE 'materials' END, trim(folder)
FROM materials WHERE class_id IS NOT NULL AND length(trim(folder)) > 0;
COMMIT;
