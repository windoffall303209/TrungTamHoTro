-- Tạo hệ bảng dữ liệu thật cho Bảng tin lớp (bài viết, tệp đính kèm, bình luận đa tầng, lượt thích, lịch sử chỉnh sửa và tùy chọn ẩn/theo dõi).

CREATE TABLE "class_feed_posts" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_role" VARCHAR(40) NOT NULL,
    "content" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_feed_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "class_feed_attachments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_feed_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "class_feed_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "author_id" TEXT NOT NULL,
    "author_role" VARCHAR(40) NOT NULL,
    "reply_to_user_id" TEXT,
    "reply_to_name" VARCHAR(150),
    "content" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_feed_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "class_feed_post_likes" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_feed_post_likes_pkey" PRIMARY KEY ("post_id","user_id")
);

CREATE TABLE "class_feed_comment_likes" (
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_feed_comment_likes_pkey" PRIMARY KEY ("comment_id","user_id")
);

CREATE TABLE "class_feed_post_edit_histories" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "editor_id" TEXT NOT NULL,
    "previous_content" TEXT NOT NULL,
    "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_feed_post_edit_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "class_feed_post_preferences" (
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "following" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_feed_post_preferences_pkey" PRIMARY KEY ("post_id","user_id")
);

CREATE INDEX "class_feed_posts_class_id_created_at_idx" ON "class_feed_posts"("class_id", "created_at");
CREATE INDEX "class_feed_posts_author_id_idx" ON "class_feed_posts"("author_id");
CREATE UNIQUE INDEX "class_feed_attachments_object_key_key" ON "class_feed_attachments"("object_key");
CREATE INDEX "class_feed_attachments_post_id_created_at_idx" ON "class_feed_attachments"("post_id", "created_at");
CREATE INDEX "class_feed_comments_post_id_created_at_idx" ON "class_feed_comments"("post_id", "created_at");
CREATE INDEX "class_feed_comments_parent_id_created_at_idx" ON "class_feed_comments"("parent_id", "created_at");
CREATE INDEX "class_feed_post_likes_user_id_created_at_idx" ON "class_feed_post_likes"("user_id", "created_at");
CREATE INDEX "class_feed_comment_likes_user_id_created_at_idx" ON "class_feed_comment_likes"("user_id", "created_at");
CREATE INDEX "class_feed_post_edit_histories_post_id_edited_at_idx" ON "class_feed_post_edit_histories"("post_id", "edited_at");
CREATE INDEX "class_feed_post_preferences_user_id_hidden_idx" ON "class_feed_post_preferences"("user_id", "hidden");

ALTER TABLE "class_feed_posts" ADD CONSTRAINT "class_feed_posts_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_posts" ADD CONSTRAINT "class_feed_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "class_feed_attachments" ADD CONSTRAINT "class_feed_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "class_feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_feed_comments" ADD CONSTRAINT "class_feed_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "class_feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_comments" ADD CONSTRAINT "class_feed_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "class_feed_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_comments" ADD CONSTRAINT "class_feed_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_feed_comments" ADD CONSTRAINT "class_feed_comments_reply_to_user_id_fkey" FOREIGN KEY ("reply_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "class_feed_post_likes" ADD CONSTRAINT "class_feed_post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "class_feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_post_likes" ADD CONSTRAINT "class_feed_post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_feed_comment_likes" ADD CONSTRAINT "class_feed_comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "class_feed_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_comment_likes" ADD CONSTRAINT "class_feed_comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_feed_post_edit_histories" ADD CONSTRAINT "class_feed_post_edit_histories_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "class_feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_post_edit_histories" ADD CONSTRAINT "class_feed_post_edit_histories_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "class_feed_post_preferences" ADD CONSTRAINT "class_feed_post_preferences_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "class_feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_feed_post_preferences" ADD CONSTRAINT "class_feed_post_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
