-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "message_feedback" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_feedback_message_id_idx" ON "message_feedback"("message_id");

-- CreateIndex
CREATE INDEX "message_feedback_user_id_idx" ON "message_feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedback_message_id_user_id_key" ON "message_feedback"("message_id", "user_id");

-- AddForeignKey
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (PostgreSQL Full-Text Search GIN index for lexical retrieval)
CREATE INDEX "document_chunks_content_fts_gin_idx"
  ON "document_chunks"
  USING gin (to_tsvector('simple', "content"));
