CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"tenant_name" text NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"user_email" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"content" text NOT NULL,
	"requires_acceptance" boolean DEFAULT true NOT NULL,
	"note" text,
	"published_by" uuid,
	"published_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_tenant_document_idx" ON "legal_acceptances" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "legal_acceptances_kind_idx" ON "legal_acceptances" USING btree ("kind","tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_version_idx" ON "legal_documents" USING btree ("kind","version");