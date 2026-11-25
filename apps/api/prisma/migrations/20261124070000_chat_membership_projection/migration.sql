-- Maintain class-chat membership in the same transaction as its source changes.
-- The class row serializes conversation creation and concurrent assignment/enrollment changes.
CREATE FUNCTION wind_refresh_class_chat_member(target_class text, target_user text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE conversation_key text; desired boolean; role_label text;
BEGIN
  PERFORM 1 FROM learning_classes WHERE id = target_class FOR NO KEY UPDATE;
  SELECT id INTO conversation_key FROM chat_conversations WHERE class_id = target_class AND type = 'CLASS';
  IF conversation_key IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM class_instructors WHERE class_id = target_class AND instructor_id = target_user)
    OR EXISTS (SELECT 1 FROM class_enrollments WHERE class_id = target_class AND learner_id = target_user AND status = 'ACTIVE')
    INTO desired;
  IF desired THEN
    SELECT COALESCE((SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = target_user AND r.code IN ('SYSTEM_ADMIN','CENTER_MANAGER','INSTRUCTOR','LEARNER')
      ORDER BY CASE r.code WHEN 'SYSTEM_ADMIN' THEN 1 WHEN 'CENTER_MANAGER' THEN 2 WHEN 'INSTRUCTOR' THEN 3 ELSE 4 END
      LIMIT 1), 'LEARNER') INTO role_label;
    INSERT INTO chat_conversation_members (conversation_id,user_id,role_snapshot,status,joined_at)
    VALUES (conversation_key,target_user,role_label,'ACTIVE',clock_timestamp())
    ON CONFLICT (conversation_id,user_id) DO UPDATE
      SET status='ACTIVE',removed_at=NULL,role_snapshot=EXCLUDED.role_snapshot
      WHERE chat_conversation_members.status <> 'ACTIVE'
         OR chat_conversation_members.removed_at IS NOT NULL
         OR chat_conversation_members.role_snapshot IS DISTINCT FROM EXCLUDED.role_snapshot;
  ELSE
    UPDATE chat_conversation_members SET status='REMOVED',removed_at=clock_timestamp()
    WHERE conversation_id=conversation_key AND user_id=target_user AND status='ACTIVE';
  END IF;
END $$;

-- Refresh just the affected user; source rows may be moved between classes/users.
CREATE FUNCTION wind_class_chat_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_user text; new_user text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_user := CASE WHEN TG_TABLE_NAME='class_instructors' THEN to_jsonb(OLD)->>'instructor_id' ELSE to_jsonb(OLD)->>'learner_id' END;
    PERFORM wind_refresh_class_chat_member(OLD.class_id,old_user);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_user := CASE WHEN TG_TABLE_NAME='class_instructors' THEN to_jsonb(NEW)->>'instructor_id' ELSE to_jsonb(NEW)->>'learner_id' END;
    IF TG_OP='INSERT' OR OLD.class_id IS DISTINCT FROM NEW.class_id OR old_user IS DISTINCT FROM new_user THEN
      PERFORM wind_refresh_class_chat_member(NEW.class_id,new_user);
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER class_chat_enrollment_changed AFTER INSERT OR UPDATE OR DELETE ON class_enrollments
FOR EACH ROW EXECUTE FUNCTION wind_class_chat_source_changed();
CREATE TRIGGER class_chat_instructor_changed AFTER INSERT OR UPDATE OR DELETE ON class_instructors
FOR EACH ROW EXECUTE FUNCTION wind_class_chat_source_changed();

-- Lock before insertion so enrollment changes cannot miss a concurrently-created conversation.
CREATE FUNCTION wind_class_chat_lock_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type='CLASS' AND NEW.class_id IS NOT NULL THEN
    PERFORM 1 FROM learning_classes WHERE id=NEW.class_id FOR NO KEY UPDATE;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER class_chat_lock_creation BEFORE INSERT ON chat_conversations
FOR EACH ROW EXECUTE FUNCTION wind_class_chat_lock_creation();

-- Initial projection is built only when a class conversation is created.
CREATE FUNCTION wind_class_chat_created() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_id text;
BEGIN
  IF NEW.type='CLASS' AND NEW.class_id IS NOT NULL THEN
    FOR member_id IN
      SELECT instructor_id FROM class_instructors WHERE class_id=NEW.class_id
      UNION SELECT learner_id FROM class_enrollments WHERE class_id=NEW.class_id AND status='ACTIVE'
      ORDER BY 1
    LOOP
      PERFORM wind_refresh_class_chat_member(NEW.class_id,member_id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER class_chat_created AFTER INSERT ON chat_conversations
FOR EACH ROW EXECUTE FUNCTION wind_class_chat_created();

-- Role labels change transactionally without waiting for a chat read.
CREATE FUNCTION wind_class_chat_role_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_id text; target_class text;
BEGIN
  FOR member_id IN SELECT DISTINCT u FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.user_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.user_id END]) AS users(u) WHERE u IS NOT NULL
  LOOP
    FOR target_class IN SELECT c.class_id FROM chat_conversations c
      JOIN chat_conversation_members m ON m.conversation_id=c.id
      WHERE c.type='CLASS' AND m.user_id=member_id ORDER BY c.class_id
    LOOP
      PERFORM wind_refresh_class_chat_member(target_class,member_id);
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER class_chat_role_changed AFTER INSERT OR UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION wind_class_chat_role_changed();

-- Reconcile existing conversations before the application switches to read-only membership access.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.class_id, m.user_id FROM chat_conversations c JOIN chat_conversation_members m ON m.conversation_id=c.id WHERE c.type='CLASS'
    UNION SELECT c.class_id,i.instructor_id FROM chat_conversations c JOIN class_instructors i ON i.class_id=c.class_id WHERE c.type='CLASS'
    UNION SELECT c.class_id,e.learner_id FROM chat_conversations c JOIN class_enrollments e ON e.class_id=c.class_id WHERE c.type='CLASS' AND e.status='ACTIVE'
    ORDER BY 1,2
  LOOP
    PERFORM wind_refresh_class_chat_member(item.class_id,item.user_id);
  END LOOP;
END $$;
