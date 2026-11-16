-- Thúc đẩy cấu hình đã đến hạn từ system_setting_revisions (nếu có) trước khi xóa bảng lịch sử và cảnh báo.
WITH latest_effective AS (
  SELECT DISTINCT ON ("key")
    "key", "value", "version", "effective_at", "updated_by", "created_at"
  FROM "system_setting_revisions"
  WHERE "effective_at" <= NOW()
  ORDER BY "key", "version" DESC
)
INSERT INTO "system_settings" ("key", "value", "version", "effective_at", "updated_by", "updated_at")
SELECT "key", "value" - 'retentionDays', "version", "effective_at", "updated_by", "created_at"
FROM latest_effective
ON CONFLICT ("key") DO UPDATE
SET
  "value" = EXCLUDED."value",
  "version" = EXCLUDED."version",
  "effective_at" = EXCLUDED."effective_at",
  "updated_by" = EXCLUDED."updated_by",
  "updated_at" = GREATEST("system_settings"."updated_at", EXCLUDED."updated_at")
WHERE EXCLUDED."version" > "system_settings"."version";

DROP TABLE IF EXISTS "system_setting_revisions";
DROP TABLE IF EXISTS "system_alerts";

-- Gộp outbox_events vào outbox_deliveries và di trú toàn bộ dữ liệu hiện có trước khi xóa outbox_events.
ALTER TABLE "outbox_deliveries"
  ADD COLUMN "event_type" VARCHAR(100),
  ADD COLUMN "aggregate_type" VARCHAR(100),
  ADD COLUMN "aggregate_id" VARCHAR(191),
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "outbox_deliveries" AS d
SET
  "event_type" = e."type",
  "aggregate_type" = e."aggregate_type",
  "aggregate_id" = e."aggregate_id",
  "payload" = e."payload",
  "created_at" = e."created_at"
FROM "outbox_events" AS e
WHERE e."id" = d."event_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "outbox_events" e
    WHERE NOT EXISTS (SELECT 1 FROM "outbox_deliveries" d WHERE d."event_id" = e."id")
      AND NULLIF(TRIM(COALESCE(e."payload"->>'recipientId', '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot merge outbox_events: event rows without deliveries lack recipientId.';
  END IF;
END $$;

INSERT INTO "outbox_deliveries" (
  "id",
  "event_id",
  "recipient_id",
  "channel",
  "dedup_key",
  "status",
  "attempts",
  "available_at",
  "updated_at",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "payload",
  "created_at"
)
SELECT
  'delivery:email:' || e."id",
  e."id",
  e."payload"->>'recipientId',
  'EMAIL',
  e."id" || ':' || (e."payload"->>'recipientId') || ':EMAIL',
  'PENDING',
  0,
  e."created_at",
  e."created_at",
  e."type",
  e."aggregate_type",
  e."aggregate_id",
  e."payload",
  e."created_at"
FROM "outbox_events" e
WHERE NOT EXISTS (SELECT 1 FROM "outbox_deliveries" d WHERE d."event_id" = e."id")
ON CONFLICT ("dedup_key") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "outbox_deliveries"
    WHERE "event_type" IS NULL
       OR "aggregate_type" IS NULL
       OR "aggregate_id" IS NULL
       OR "payload" IS NULL
       OR "created_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Incomplete outbox_deliveries migration: NULL event fields remain.';
  END IF;
END $$;

ALTER TABLE "outbox_deliveries"
  ALTER COLUMN "event_type" SET NOT NULL,
  ALTER COLUMN "aggregate_type" SET NOT NULL,
  ALTER COLUMN "aggregate_id" SET NOT NULL,
  ALTER COLUMN "payload" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL;

CREATE INDEX "outbox_deliveries_event_type_created_at_idx"
  ON "outbox_deliveries"("event_type", "created_at");

ALTER TABLE "outbox_deliveries" DROP CONSTRAINT IF EXISTS "outbox_deliveries_event_id_fkey";
ALTER TABLE "outbox_deliveries" DROP COLUMN "event_id";

DROP TABLE IF EXISTS "outbox_events";

-- Cập nhật trigger thông báo để chèn trực tiếp vào outbox_deliveries trong cùng transaction của notifications.
CREATE OR REPLACE FUNCTION create_notification_outbox()
RETURNS TRIGGER AS $$
DECLARE
    dedup_prefix TEXT := 'notification:' || NEW.id;
BEGIN
    INSERT INTO "outbox_deliveries" (
        "id",
        "event_type",
        "aggregate_type",
        "aggregate_id",
        "payload",
        "recipient_id",
        "channel",
        "dedup_key",
        "status",
        "attempts",
        "available_at",
        "created_at",
        "updated_at"
    )
    VALUES (
        'delivery:email:' || NEW.id,
        'NOTIFICATION_CREATED',
        NEW."entity_type",
        NEW."entity_id",
        jsonb_build_object(
            'notificationId', NEW.id,
            'recipientId', NEW."recipient_id",
            'notificationType', NEW.type,
            'title', NEW.title,
            'entityType', NEW."entity_type",
            'entityId', NEW."entity_id"
        ),
        NEW."recipient_id",
        'EMAIL',
        dedup_prefix || ':' || NEW."recipient_id" || ':EMAIL',
        'PENDING',
        0,
        NEW."created_at",
        NEW."created_at",
        NEW."created_at"
    )
    ON CONFLICT ("dedup_key") DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
