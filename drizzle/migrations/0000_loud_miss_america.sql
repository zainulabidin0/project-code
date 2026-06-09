CREATE TYPE "public"."correction_type" AS ENUM('REGEX_ONLY', 'AI_CORRECTED', 'NO_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('FREE', 'STARTER', 'PRO', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('SUCCESS', 'ERROR', 'RATE_LIMITED');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('POSITIVE', 'NEGATIVE');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"hashed_key" varchar(64) NOT NULL,
	"name" varchar(255) DEFAULT 'Default' NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"user_id" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"family_id" varchar(128) NOT NULL,
	"user_agent" text,
	"ip" varchar(45),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "review_page_settings" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"slug" varchar(100),
	"page_title" varchar(255),
	"description" text,
	"show_scores" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_page_settings_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "review_page_settings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"review_text" text NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"score" integer NOT NULL,
	"confidence" integer,
	"reviewer_name" varchar(255),
	"reviewer_meta" text,
	"processing_ms" integer NOT NULL,
	"ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_chat_sessions" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"store_id" varchar(128) NOT NULL,
	"session_token" varchar(128) NOT NULL,
	"cart_token" varchar(255),
	"messages" text DEFAULT '[]' NOT NULL,
	"session_context" text DEFAULT '{}' NOT NULL,
	"ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shop_chat_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "shop_customer_profiles" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"store_id" varchar(128) NOT NULL,
	"identifier" text NOT NULL,
	"identifier_type" text NOT NULL,
	"checkout_draft" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_usage_logs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"store_id" varchar(128) NOT NULL,
	"session_id" varchar(128),
	"action_type" varchar(50) NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"processing_ms" integer NOT NULL,
	"status" "request_status" DEFAULT 'SUCCESS' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_stores" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"store_name" varchar(255),
	"access_token" text NOT NULL,
	"storefront_token" text,
	"widget_position" varchar(20) DEFAULT 'bottom-right' NOT NULL,
	"widget_color" varchar(7) DEFAULT '#000000' NOT NULL,
	"widget_greeting" text DEFAULT 'What would you like to buy today?' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"auth_status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"theme_version" varchar(10) DEFAULT 'unknown' NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_stores_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "shopify_stores_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"input_address" text NOT NULL,
	"output_address" text NOT NULL,
	"correction_type" "correction_type" NOT NULL,
	"processing_ms" integer NOT NULL,
	"status" "request_status" DEFAULT 'SUCCESS' NOT NULL,
	"error_message" text,
	"ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"verify_token" varchar(255),
	"reset_token" varchar(255),
	"reset_token_exp" timestamp,
	"plan" "plan" DEFAULT 'FREE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_verify_token_unique" UNIQUE("verify_token"),
	CONSTRAINT "users_reset_token_unique" UNIQUE("reset_token")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_page_settings" ADD CONSTRAINT "review_page_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_chat_sessions" ADD CONSTRAINT "shop_chat_sessions_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_customer_profiles" ADD CONSTRAINT "shop_customer_profiles_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_usage_logs" ADD CONSTRAINT "shop_usage_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_usage_logs" ADD CONSTRAINT "shop_usage_logs_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hashed_key_idx" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_project_id_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "reviews_project_id_idx" ON "reviews" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "reviews_project_created_idx" ON "reviews" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_sentiment_idx" ON "reviews" USING btree ("project_id","sentiment");--> statement-breakpoint
CREATE INDEX "shop_chat_sessions_store_id_idx" ON "shop_chat_sessions" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_chat_sessions_token_idx" ON "shop_chat_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_customer_profiles_store_identifier_idx" ON "shop_customer_profiles" USING btree ("store_id","identifier");--> statement-breakpoint
CREATE INDEX "shop_usage_logs_project_created_idx" ON "shop_usage_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "shopify_stores_project_id_idx" ON "shopify_stores" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_stores_shop_domain_idx" ON "shopify_stores" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "usage_logs_project_created_idx" ON "usage_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_created_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");