CREATE TABLE "ai_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"daily_cost_micros" integer,
	"daily_tokens" integer,
	"daily_messages" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "unpriced_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_limits" ADD CONSTRAINT "ai_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;