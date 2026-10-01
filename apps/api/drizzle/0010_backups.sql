CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"trigger" text NOT NULL,
	"includes_uploads" boolean DEFAULT true NOT NULL,
	"s3_key" text,
	"created_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_started_idx" ON "backups" USING btree ("started_at");