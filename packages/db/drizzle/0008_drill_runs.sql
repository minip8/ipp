CREATE TABLE "drill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"level" text NOT NULL,
	"categories" text[] NOT NULL,
	"full_mix" boolean NOT NULL,
	"by_category" jsonb NOT NULL,
	"correct" integer NOT NULL,
	"wrong" integer NOT NULL,
	"skipped" integer NOT NULL,
	"score" integer NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drill_runs" ADD CONSTRAINT "drill_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drill_runs_user_idx" ON "drill_runs" USING btree ("user_id","finished_at" DESC NULLS LAST);