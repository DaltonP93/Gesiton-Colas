CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"code" text NOT NULL,
	"external_id" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 15 NOT NULL,
	"customer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"professional" text,
	"notes" text DEFAULT '' NOT NULL,
	"public_token" text NOT NULL,
	"ticket_id" uuid,
	"checked_in_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"days" jsonb NOT NULL,
	"from_time" text NOT NULL,
	"to_time" text NOT NULL,
	"slot_minutes" integer NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "tickets_queue_idx";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sort_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Los turnos existentes conservan su orden (hora de emisión).
UPDATE "tickets" SET "sort_at" = "created_at";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_tenant_code_idx" ON "appointments" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_public_token_idx" ON "appointments" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_external_idx" ON "appointments" USING btree ("tenant_id","external_id") WHERE "appointments"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_branch_time_idx" ON "appointments" USING btree ("branch_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_tenant_time_idx" ON "appointments" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_document_idx" ON "appointments" USING btree ("tenant_id","document");--> statement-breakpoint
CREATE INDEX "booking_schedules_branch_idx" ON "booking_schedules" USING btree ("branch_id","service_id");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("branch_id","status","sort_at");