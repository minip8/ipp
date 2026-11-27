CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"track" text NOT NULL,
	"preset" text,
	"stages" jsonb NOT NULL,
	"interviewer" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pads" ADD COLUMN "interview_id" uuid;--> statement-breakpoint
ALTER TABLE "pads" ADD COLUMN "stage_index" integer;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_owner_idx" ON "interviews" USING btree ("owner_id","started_at");--> statement-breakpoint
ALTER TABLE "pads" ADD CONSTRAINT "pads_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pads_interview_stage_idx" ON "pads" USING btree ("interview_id","stage_index") WHERE "pads"."interview_id" is not null;