ALTER TABLE "quiz_topics" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_topics" ADD COLUMN "roadmap" jsonb DEFAULT '[]'::jsonb NOT NULL;