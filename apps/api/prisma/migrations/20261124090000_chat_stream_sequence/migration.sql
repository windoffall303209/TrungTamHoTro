BEGIN;
-- Backfill and install the allocator atomically before accepting new message writes.
LOCK TABLE chat_conversations, chat_messages IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE chat_conversations ADD COLUMN message_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN stream_sequence bigint NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at,id) AS position
  FROM chat_messages
)
UPDATE chat_messages m SET stream_sequence=o.position FROM ordered o WHERE o.id=m.id;
UPDATE chat_conversations c SET message_sequence=s.position
FROM (SELECT conversation_id,max(stream_sequence) AS position FROM chat_messages GROUP BY conversation_id) s
WHERE c.id=s.conversation_id;
CREATE UNIQUE INDEX chat_messages_conversation_id_stream_sequence_key ON chat_messages(conversation_id,stream_sequence);

-- A conversation-local row lock is held until commit/rollback. A later allocator cannot
-- commit a higher sequence before an earlier message in the same conversation.
CREATE FUNCTION wind_chat_assign_stream_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chat_conversations SET message_sequence=message_sequence+1
  WHERE id=NEW.conversation_id RETURNING message_sequence INTO NEW.stream_sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chat conversation does not exist' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_assign_stream_sequence BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION wind_chat_assign_stream_sequence();
COMMIT;
