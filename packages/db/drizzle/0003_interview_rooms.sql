ALTER TABLE "pads" ALTER COLUMN "problem_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pads" ADD COLUMN "kind" text DEFAULT 'practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "pads" ADD COLUMN "host_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "problem_slug" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;