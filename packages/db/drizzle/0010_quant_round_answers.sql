CREATE TABLE "quant_round_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pad_id" uuid,
	"question_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"score" real NOT NULL,
	"correct" boolean NOT NULL,
	"feedback" text,
	"graded_by" text NOT NULL,
	"needs_self_grade" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quant_round_answers" ADD CONSTRAINT "quant_round_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_round_answers" ADD CONSTRAINT "quant_round_answers_pad_id_pads_id_fk" FOREIGN KEY ("pad_id") REFERENCES "public"."pads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_round_answers" ADD CONSTRAINT "quant_round_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quant_round_answers_pad_question_idx" ON "quant_round_answers" USING btree ("pad_id","question_id");--> statement-breakpoint
CREATE INDEX "quant_round_answers_user_idx" ON "quant_round_answers" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "quant_round_answers_question_idx" ON "quant_round_answers" USING btree ("question_id");