CREATE TABLE "quant_games" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"difficulty" text NOT NULL,
	"data" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quant_games" ADD CONSTRAINT "quant_games_topic_quiz_topics_slug_fk" FOREIGN KEY ("topic") REFERENCES "public"."quiz_topics"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quant_games_topic_idx" ON "quant_games" USING btree ("topic");