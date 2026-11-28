-- PostgreSQL delivers NOTIFY only after the surrounding transaction commits.
CREATE FUNCTION wind_chat_message_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wind_events', json_build_object('kind','chat','key',NEW.conversation_id)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER chat_message_event AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION wind_chat_message_event();

-- Wake open streams on membership changes as well, so access is checked promptly.
CREATE FUNCTION wind_chat_membership_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wind_events', json_build_object('kind','chat','key',
    CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER chat_membership_event AFTER INSERT OR UPDATE OF status, removed_at, role_snapshot OR DELETE ON chat_conversation_members
FOR EACH ROW EXECUTE FUNCTION wind_chat_membership_event();
