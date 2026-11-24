ALTER TABLE "problems" ADD COLUMN "languages" text[] DEFAULT '{cpp,python,java}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "starter_code" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "harness" jsonb DEFAULT '{}'::jsonb NOT NULL;