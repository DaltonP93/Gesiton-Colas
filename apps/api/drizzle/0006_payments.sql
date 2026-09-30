CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" serial NOT NULL,
	"period" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" date NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"method" text,
	"reference" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_gateways" (
	"scope" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sandbox" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text DEFAULT '' NOT NULL,
	"webhook_secret_enc" text DEFAULT '' NOT NULL,
	"webhook_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" serial NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" uuid,
	"ticket_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"method" text,
	"reference" text,
	"provider_ref" text,
	"checkout_url" text,
	"public_token" text NOT NULL,
	"return_url" text,
	"recorded_by" uuid,
	"raw" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD CONSTRAINT "payment_gateways_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_seq_idx" ON "invoices" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_period_idx" ON "invoices" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_gateways_webhook_idx" ON "payment_gateways" USING btree ("webhook_token");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_seq_idx" ON "payments" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_public_token_idx" ON "payments" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_ticket_idx" ON "payments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("provider","provider_ref");