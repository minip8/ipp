CREATE TABLE "quant_rounds" (
	"pad_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pads" ADD COLUMN "format" text DEFAULT 'coding' NOT NULL;--> statement-breakpoint
ALTER TABLE "quant_rounds" ADD CONSTRAINT "quant_rounds_pad_id_pads_id_fk" FOREIGN KEY ("pad_id") REFERENCES "public"."pads"("id") ON DELETE cascade ON UPDATE no action;