-- Keep notification delivery records in the same transaction as the notification.
CREATE OR REPLACE FUNCTION create_notification_outbox()
RETURNS TRIGGER AS $$
DECLARE
    event_id TEXT := 'notification:' || NEW.id;
BEGIN
    INSERT INTO "outbox_events" (
        "id",
        "type",
        "aggregate_type",
        "aggregate_id",
        "payload",
        "created_at"
    )
    VALUES (
        event_id,
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
        NEW."created_at"
    )
    ON CONFLICT ("id") DO NOTHING;

    INSERT INTO "outbox_deliveries" (
        "id",
        "event_id",
        "recipient_id",
        "channel",
        "dedup_key",
        "status",
        "attempts",
        "available_at",
        "updated_at"
    )
    VALUES (
        'delivery:email:' || NEW.id,
        event_id,
        NEW."recipient_id",
        'EMAIL',
        event_id || ':' || NEW."recipient_id" || ':EMAIL',
        'PENDING',
        0,
        NEW."created_at",
        NEW."created_at"
    )
    ON CONFLICT ("dedup_key") DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notifications_after_insert_outbox
AFTER INSERT ON "notifications"
FOR EACH ROW
EXECUTE FUNCTION create_notification_outbox();
