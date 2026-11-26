ALTER TABLE "quiz_topics" ADD COLUMN "also" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "track" text;