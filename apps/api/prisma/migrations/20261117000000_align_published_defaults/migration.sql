BEGIN;

-- Đồng bộ giá trị mặc định cho bản ghi mới trên các DB đã chạy migration cũ.
ALTER TABLE public.assignments ALTER COLUMN status SET DEFAULT 'PUBLISHED';
ALTER TABLE public.materials ALTER COLUMN visibility SET DEFAULT 'PUBLISHED';

COMMIT;
