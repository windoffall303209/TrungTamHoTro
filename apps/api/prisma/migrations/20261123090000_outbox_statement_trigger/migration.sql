-- PERF-04: trigger outbox chạy một lần cho mỗi câu lệnh INSERT (transition table) thay vì từng dòng,
-- và chỉ tạo delivery EMAIL khi người nhận có email và (không phải học viên hoặc đã bật email cho học viên).
-- Thông báo hàng loạt (đóng lớp, công bố điểm) không còn chèn hàng nghìn dòng outbox sẽ bị SKIPPED ngay sau đó.
DROP TRIGGER IF EXISTS notifications_after_insert_outbox ON "notifications";

CREATE OR REPLACE FUNCTION create_notification_outbox_batch()
RETURNS TRIGGER AS $$
DECLARE
    learner_email_enabled BOOLEAN := COALESCE(
        (SELECT ("value"->>'learnerEmailNotificationsEnabled')::boolean FROM "system_settings" WHERE "key" = 'platform'),
        false
    );
BEGIN
    INSERT INTO "outbox_deliveries" (
        "id", "event_type", "aggregate_type", "aggregate_id", "payload", "recipient_id", "channel",
        "dedup_key", "status", "attempts", "available_at", "created_at", "updated_at"
    )
    SELECT
        'delivery:email:' || n."id",
        'NOTIFICATION_CREATED',
        n."entity_type",
        n."entity_id",
        jsonb_build_object(
            'notificationId', n."id",
            'recipientId', n."recipient_id",
            'notificationType', n."type",
            'title', n."title",
            'entityType', n."entity_type",
            'entityId', n."entity_id"
        ),
        n."recipient_id",
        'EMAIL',
        'notification:' || n."id" || ':' || n."recipient_id" || ':EMAIL',
        'PENDING',
        0,
        n."created_at",
        n."created_at",
        n."created_at"
    FROM inserted_notifications n
    JOIN "users" u ON u."id" = n."recipient_id"
    WHERE u."email" IS NOT NULL
      AND (
        learner_email_enabled
        OR NOT EXISTS (
            SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
            WHERE ur."user_id" = u."id" AND r."code" = 'LEARNER'
        )
      )
    ON CONFLICT ("dedup_key") DO NOTHING;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notifications_after_insert_outbox
AFTER INSERT ON "notifications"
REFERENCING NEW TABLE AS inserted_notifications
FOR EACH STATEMENT
EXECUTE FUNCTION create_notification_outbox_batch();

DROP FUNCTION IF EXISTS create_notification_outbox();
