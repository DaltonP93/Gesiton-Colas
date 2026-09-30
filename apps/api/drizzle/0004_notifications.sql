CREATE TABLE "notify_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid,
	"event" text NOT NULL,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider_ref" text,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notify_providers" (
	"scope" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'waha' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notify_messages" ADD CONSTRAINT "notify_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify_messages" ADD CONSTRAINT "notify_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify_providers" ADD CONSTRAINT "notify_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notify_messages_due_idx" ON "notify_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notify_messages_tenant_idx" ON "notify_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notify_messages_ticket_event_idx" ON "notify_messages" USING btree ("ticket_id","event");