CREATE TABLE "sifen_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"tenant_id" uuid,
	"cdc" text NOT NULL,
	"type" integer DEFAULT 1 NOT NULL,
	"establishment" text NOT NULL,
	"point" text NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"environment" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"receiver" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"currency" text DEFAULT 'PYG' NOT NULL,
	"exchange_rate" real,
	"condition" text DEFAULT 'cash' NOT NULL,
	"payment_type" integer DEFAULT 1 NOT NULL,
	"credit_days" integer,
	"notes" text DEFAULT '' NOT NULL,
	"totals" jsonb NOT NULL,
	"xml" text NOT NULL,
	"qr_url" text NOT NULL,
	"issuer" jsonb NOT NULL,
	"set_code" text,
	"set_message" text,
	"set_protocol" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"public_token" text NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sifen_issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"tenant_id" uuid,
	"settings" jsonb NOT NULL,
	"cert_enc" text DEFAULT '' NOT NULL,
	"cert_password_enc" text DEFAULT '' NOT NULL,
	"cert_info" jsonb,
	"csc_enc" text DEFAULT '' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sifen_documents" ADD CONSTRAINT "sifen_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sifen_documents" ADD CONSTRAINT "sifen_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sifen_issuers" ADD CONSTRAINT "sifen_issuers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sifen_documents_number_idx" ON "sifen_documents" USING btree ("scope","type","establishment","point","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sifen_documents_cdc_idx" ON "sifen_documents" USING btree ("cdc");--> statement-breakpoint
CREATE UNIQUE INDEX "sifen_documents_token_idx" ON "sifen_documents" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "sifen_documents_scope_created_idx" ON "sifen_documents" USING btree ("scope","created_at");--> statement-breakpoint
CREATE INDEX "sifen_documents_source_idx" ON "sifen_documents" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sifen_issuers_scope_idx" ON "sifen_issuers" USING btree ("scope");