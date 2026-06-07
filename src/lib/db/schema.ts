import {
  pgTable,
  pgEnum,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export const planEnum = pgEnum("plan", [
  "FREE",
  "STARTER",
  "PRO",
  "ENTERPRISE",
]);

export const correctionTypeEnum = pgEnum("correction_type", [
  "REGEX_ONLY",
  "AI_CORRECTED",
  "NO_CHANGE",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "SUCCESS",
  "ERROR",
  "RATE_LIMITED",
]);

export const sentimentEnum = pgEnum("sentiment", [
  "POSITIVE",
  "NEGATIVE",
]);

export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 255 }),
    emailVerified: boolean("email_verified").default(false).notNull(),
    verifyToken: varchar("verify_token", { length: 255 }).unique(),
    resetToken: varchar("reset_token", { length: 255 }).unique(),
    resetTokenExp: timestamp("reset_token_exp"),
    plan: planEnum("plan").default("FREE").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("users_email_idx").on(table.email)]
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    token: text("token").notNull().unique(),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: varchar("family_id", { length: 128 }).notNull(),
    userAgent: text("user_agent"),
    ip: varchar("ip", { length: 45 }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("refresh_tokens_token_idx").on(table.token),
    index("refresh_tokens_user_id_idx").on(table.userId),
    index("refresh_tokens_family_idx").on(table.familyId),
  ]
);

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const projects = pgTable(
  "projects",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("projects_user_id_idx").on(table.userId)]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    hashedKey: varchar("hashed_key", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 255 }).default("Default").notNull(),
    projectId: varchar("project_id", { length: 128 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").default(true).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_hashed_key_idx").on(table.hashedKey),
    index("api_keys_project_id_idx").on(table.projectId),
  ]
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
}));

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: varchar("project_id", { length: 128 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inputAddress: text("input_address").notNull(),
    outputAddress: text("output_address").notNull(),
    correctionType: correctionTypeEnum("correction_type").notNull(),
    processingMs: integer("processing_ms").notNull(),
    status: requestStatusEnum("status").default("SUCCESS").notNull(),
    errorMessage: text("error_message"),
    ip: varchar("ip", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_logs_project_created_idx").on(table.projectId, table.createdAt),
    index("usage_logs_created_idx").on(table.createdAt),
  ]
);

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
  project: one(projects, {
    fields: [usageLogs.projectId],
    references: [projects.id],
  }),
}));

export const reviews = pgTable(
  "reviews",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: varchar("project_id", { length: 128 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reviewText: text("review_text").notNull(),
    sentiment: sentimentEnum("sentiment").notNull(),
    score: integer("score").notNull(),
    confidence: integer("confidence"),
    reviewerName: varchar("reviewer_name", { length: 255 }),
    reviewerMeta: text("reviewer_meta"),
    processingMs: integer("processing_ms").notNull(),
    ip: varchar("ip", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("reviews_project_id_idx").on(table.projectId),
    index("reviews_project_created_idx").on(table.projectId, table.createdAt),
    index("reviews_sentiment_idx").on(table.projectId, table.sentiment),
  ]
);

export const reviewPageSettings = pgTable("review_page_settings", {
  id: varchar("id", { length: 128 })
    .$defaultFn(() => createId())
    .primaryKey(),
  projectId: varchar("project_id", { length: 128 })
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  isPublic: boolean("is_public").default(false).notNull(),
  slug: varchar("slug", { length: 100 }).unique(),
  pageTitle: varchar("page_title", { length: 255 }),
  description: text("description"),
  showScores: boolean("show_scores").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const shopifyStores = pgTable(
  "shopify_stores",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: varchar("project_id", { length: 128 })
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    shopDomain: varchar("shop_domain", { length: 255 }).notNull().unique(),
    storeName: varchar("store_name", { length: 255 }),
    accessToken: text("access_token").notNull(),
    storefrontToken: text("storefront_token"),
    widgetPosition: varchar("widget_position", { length: 20 })
      .default("bottom-right")
      .notNull(),
    widgetColor: varchar("widget_color", { length: 7 }).default("#000000").notNull(),
    widgetGreeting: text("widget_greeting")
      .default("What would you like to buy today?")
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    authStatus: varchar("auth_status", { length: 30 }).default("ACTIVE").notNull(),
    themeVersion: varchar("theme_version", { length: 10 }).default("unknown").notNull(),
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    uninstalledAt: timestamp("uninstalled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("shopify_stores_project_id_idx").on(table.projectId),
    uniqueIndex("shopify_stores_shop_domain_idx").on(table.shopDomain),
  ]
);

export const shopChatSessions = pgTable(
  "shop_chat_sessions",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    storeId: varchar("store_id", { length: 128 })
      .notNull()
      .references(() => shopifyStores.id, { onDelete: "cascade" }),
    sessionToken: varchar("session_token", { length: 128 }).notNull().unique(),
    cartToken: varchar("cart_token", { length: 255 }),
    messages: text("messages").notNull().default("[]"),
    sessionContext: text("session_context").notNull().default("{}"),
    ip: varchar("ip", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("shop_chat_sessions_store_id_idx").on(table.storeId),
    uniqueIndex("shop_chat_sessions_token_idx").on(table.sessionToken),
  ]
);

export const shopUsageLogs = pgTable(
  "shop_usage_logs",
  {
    id: varchar("id", { length: 128 })
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: varchar("project_id", { length: 128 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storeId: varchar("store_id", { length: 128 })
      .notNull()
      .references(() => shopifyStores.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 128 }),
    actionType: varchar("action_type", { length: 50 }).notNull(),
    tokensUsed: integer("tokens_used").default(0).notNull(),
    processingMs: integer("processing_ms").notNull(),
    status: requestStatusEnum("status").default("SUCCESS").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("shop_usage_logs_project_created_idx").on(table.projectId, table.createdAt)]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  apiKeys: many(apiKeys),
  usageLogs: many(usageLogs),
  reviews: many(reviews),
  reviewPageSettings: one(reviewPageSettings),
  shopifyStore: one(shopifyStores),
  shopUsageLogs: many(shopUsageLogs),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  project: one(projects, {
    fields: [reviews.projectId],
    references: [projects.id],
  }),
}));

export const reviewPageSettingsRelations = relations(
  reviewPageSettings,
  ({ one }) => ({
    project: one(projects, {
      fields: [reviewPageSettings.projectId],
      references: [projects.id],
    }),
  })
);

export const shopifyStoresRelations = relations(shopifyStores, ({ one, many }) => ({
  project: one(projects, { fields: [shopifyStores.projectId], references: [projects.id] }),
  chatSessions: many(shopChatSessions),
  usageLogs: many(shopUsageLogs),
}));

export const shopChatSessionsRelations = relations(shopChatSessions, ({ one }) => ({
  store: one(shopifyStores, { fields: [shopChatSessions.storeId], references: [shopifyStores.id] }),
}));

export const shopUsageLogsRelations = relations(shopUsageLogs, ({ one }) => ({
  project: one(projects, { fields: [shopUsageLogs.projectId], references: [projects.id] }),
  store: one(shopifyStores, { fields: [shopUsageLogs.storeId], references: [shopifyStores.id] }),
}));

export type Plan = (typeof planEnum.enumValues)[number];
export type CorrectionType = (typeof correctionTypeEnum.enumValues)[number];
export type Sentiment = (typeof sentimentEnum.enumValues)[number];
