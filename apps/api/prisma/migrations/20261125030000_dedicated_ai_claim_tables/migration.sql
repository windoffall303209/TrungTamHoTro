-- Giai đoạn 1 (Expand + Backfill): Tách dữ liệu OCR, hỏi đáp tài liệu và sinh đề AI khỏi system_settings.
-- Giữ nguyên bản ghi cũ trong system_settings để bảo đảm rollback an toàn; chỉ xóa sau khi kiểm chứng đối chiếu.

CREATE TABLE "ai_document_extractions" (
  "id" VARCHAR(191) NOT NULL,
  "owner_id" VARCHAR(191) NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'GENERATING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "pages" JSONB,
  "lease_token" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_document_extractions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_document_answers" (
  "id" VARCHAR(191) NOT NULL,
  "owner_id" VARCHAR(191) NOT NULL,
  "material_id" VARCHAR(191),
  "source_version" INTEGER,
  "question" TEXT,
  "language" VARCHAR(16),
  "state" VARCHAR(24) NOT NULL DEFAULT 'GENERATING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "result" JSONB,
  "lease_token" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_document_answers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_generation_requests" (
  "id" VARCHAR(177) NOT NULL,
  "owner_id" VARCHAR(191) NOT NULL,
  "payload_hash" VARCHAR(191) NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'CLAIMED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "prepared" JSONB,
  "result" JSONB,
  "lease_token" VARCHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_generation_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_generation_bindings" (
  "fingerprint" VARCHAR(191) NOT NULL,
  "owner_id" VARCHAR(191) NOT NULL,
  "payload_hash" VARCHAR(191) NOT NULL,
  "canonical_request_id" VARCHAR(177),
  "malformed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_generation_bindings_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "ai_document_extractions_state_created_id_idx"
  ON "ai_document_extractions" ("state", "created_at" DESC, "id" DESC);

CREATE INDEX "ai_document_extractions_generating_lease_idx"
  ON "ai_document_extractions" ("lease_expires_at")
  WHERE "state" = 'GENERATING' AND "lease_expires_at" IS NOT NULL;

CREATE INDEX "ai_document_answers_history_idx"
  ON "ai_document_answers" ("owner_id", "material_id", "source_version", "created_at" DESC, "id" DESC);

CREATE INDEX "ai_document_answers_state_created_id_idx"
  ON "ai_document_answers" ("state", "created_at" DESC, "id" DESC);

CREATE INDEX "ai_document_answers_generating_lease_idx"
  ON "ai_document_answers" ("lease_expires_at")
  WHERE "state" = 'GENERATING' AND "lease_expires_at" IS NOT NULL;

CREATE INDEX "ai_generation_requests_state_created_id_idx"
  ON "ai_generation_requests" ("state", "created_at" DESC, "id" DESC);

CREATE INDEX "ai_generation_requests_owner_hash_idx"
  ON "ai_generation_requests" ("owner_id", "payload_hash");

CREATE INDEX "ai_generation_requests_generating_lease_idx"
  ON "ai_generation_requests" ("lease_expires_at")
  WHERE "state" = 'GENERATING' AND "lease_expires_at" IS NOT NULL;

CREATE INDEX "ai_generation_bindings_canonical_idx"
  ON "ai_generation_bindings" ("canonical_request_id");

CREATE INDEX "ai_generation_bindings_owner_hash_idx"
  ON "ai_generation_bindings" ("owner_id", "payload_hash");

-- Backfill idempotent bản ghi OCR cũ (bao gồm cả bộ đệm mảng cũ lẫn object trạng thái mới).
INSERT INTO "ai_document_extractions" (
  "id", "owner_id", "state", "version", "pages", "lease_token", "lease_expires_at", "created_at", "updated_at"
)
SELECT
  SUBSTRING("key" FROM 8),
  "updated_by",
  CASE
    WHEN jsonb_typeof("value") = 'array' THEN 'READY'
    WHEN "value"->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY') THEN "value"->>'state'
    ELSE 'UNCERTAIN'
  END,
  "version",
  CASE
    WHEN jsonb_typeof("value") = 'array' THEN "value"
    WHEN "value"->>'state' = 'READY' THEN "value"->'pages'
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
      THEN LEFT("value"->>'leaseToken', 64)
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING'
      AND ("value"->>'leaseExpiresAt') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN ("value"->>'leaseExpiresAt')::timestamptz
    ELSE NULL
  END,
  "effective_at",
  "updated_at"
FROM "system_settings"
WHERE "key" LIKE 'ai-doc:%'
ON CONFLICT ("id") DO NOTHING;

-- Backfill idempotent bản ghi hỏi đáp tài liệu AI.
INSERT INTO "ai_document_answers" (
  "id", "owner_id", "material_id", "source_version", "question", "language",
  "state", "version", "result", "lease_token", "lease_expires_at", "created_at", "updated_at"
)
SELECT
  SUBSTRING("key" FROM 15),
  "updated_by",
  CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'materialId' ELSE NULL END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND jsonb_typeof("value"->'request'->'version') = 'number'
      THEN ("value"->'request'->>'version')::integer
    ELSE NULL
  END,
  CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'question' ELSE NULL END,
  CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'language' ELSE NULL END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY')
      THEN "value"->>'state'
    ELSE 'UNCERTAIN'
  END,
  "version",
  CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'READY' THEN "value"->'result' ELSE NULL END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
      THEN LEFT("value"->>'leaseToken', 64)
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING'
      AND ("value"->>'leaseExpiresAt') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN ("value"->>'leaseExpiresAt')::timestamptz
    ELSE NULL
  END,
  "effective_at",
  "updated_at"
FROM "system_settings"
WHERE "key" LIKE 'ai-doc-answer:%'
ON CONFLICT ("id") DO NOTHING;

-- Backfill idempotent bản ghi yêu cầu sinh đề AI.
INSERT INTO "ai_generation_requests" (
  "id", "owner_id", "payload_hash", "state", "version", "prepared", "result",
  "lease_token", "lease_expires_at", "created_at", "updated_at"
)
SELECT
  SUBSTRING("key" FROM 15),
  COALESCE(NULLIF("value"->>'owner', ''), "updated_by"),
  COALESCE("value"->>'hash', ''),
  CASE
    WHEN jsonb_typeof("value") = 'object'
      AND "value"->>'state' IN ('CLAIMED', 'GENERATING', 'READY', 'SAVING', 'COMPLETED', 'UNCERTAIN')
      THEN "value"->>'state'
    ELSE 'UNCERTAIN'
  END,
  "version",
  CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'prepared' ELSE NULL END,
  CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'result' ELSE NULL END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
      THEN LEFT("value"->>'leaseToken', 64)
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING'
      AND ("value"->>'leaseExpiresAt') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN ("value"->>'leaseExpiresAt')::timestamptz
    ELSE NULL
  END,
  "effective_at",
  "updated_at"
FROM "system_settings"
WHERE "key" LIKE 'ai-generation:%'
ON CONFLICT ("id") DO NOTHING;

-- Backfill idempotent liên kết fingerprint -> canonicalRequestId của sinh đề AI.
INSERT INTO "ai_generation_bindings" (
  "fingerprint", "owner_id", "payload_hash", "canonical_request_id", "malformed", "created_at", "updated_at"
)
SELECT
  SUBSTRING("key" FROM 23),
  COALESCE(NULLIF("value"->>'owner', ''), "updated_by"),
  COALESCE("value"->>'hash', ''),
  CASE
    WHEN jsonb_typeof("value") = 'object'
      AND jsonb_typeof("value"->'canonicalRequestId') = 'string'
      AND CHAR_LENGTH(BTRIM("value"->>'canonicalRequestId')) > 0
      THEN LEFT("value"->>'canonicalRequestId', 177)
    ELSE NULL
  END,
  NOT (
    jsonb_typeof("value") = 'object'
    AND jsonb_typeof("value"->'canonicalRequestId') = 'string'
    AND CHAR_LENGTH(BTRIM("value"->>'canonicalRequestId')) > 0
  ),
  "effective_at",
  "updated_at"
FROM "system_settings"
WHERE "key" LIKE 'ai-generation-content:%'
ON CONFLICT ("fingerprint") DO NOTHING;
