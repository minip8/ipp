CREATE TABLE "quiz_standalone_answers" (
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"score" real NOT NULL,
	"correct" boolean NOT NULL,
	"feedback" text,
	"graded_by" text NOT NULL,
	"needs_self_grade" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_standalone_answers_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "category" text DEFAULT 'dsa' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_standalone_answers" ADD CONSTRAINT "quiz_standalone_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_standalone_answers" ADD CONSTRAINT "quiz_standalone_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_standalone_answers_question_idx" ON "quiz_standalone_answers" USING btree ("question_id");