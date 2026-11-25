-- Recipient-scoped invalidation; delivered only after commit, without message data.
CREATE FUNCTION wind_chat_list_message_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wind_events', json_build_object('kind','chat-list','key',member.user_id)::text)
  FROM chat_conversation_members member
  WHERE member.conversation_id = NEW.conversation_id AND member.status = 'ACTIVE';
  RETURN NULL;
END $$;
CREATE TRIGGER chat_list_message_event AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION wind_chat_list_message_event();

-- Membership/read/mute changes only invalidate the affected user's list.
CREATE FUNCTION wind_chat_list_member_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM pg_notify('wind_events', json_build_object('kind','chat-list','key',OLD.user_id)::text);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM pg_notify('wind_events', json_build_object('kind','chat-list','key',NEW.user_id)::text);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER chat_list_member_event AFTER INSERT OR UPDATE OR DELETE ON chat_conversation_members
FOR EACH ROW EXECUTE FUNCTION wind_chat_list_member_event();
