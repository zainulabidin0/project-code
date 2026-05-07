import { z } from "zod";

const reviewerMetaSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .transform((m) => m ?? undefined);

export const singleSentimentRequestSchema = z.object({
  review: z
    .string()
    .min(1, "Review is required")
    .max(5000, "Review exceeds 5000 characters"),
  reviewerName: z.string().max(255).optional(),
  reviewerMeta: reviewerMetaSchema,
});

const batchItemSchema = z.object({
  review: z.string().min(1).max(5000),
  reviewerName: z.string().max(255).optional(),
  reviewerMeta: reviewerMetaSchema,
});

export const sentimentBatchRequestSchema = z.object({
  reviews: z
    .array(batchItemSchema)
    .min(1, "At least one review")
    .max(50, "At most 50 reviews per batch"),
});

const slugSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "Slug: lowercase letters, numbers, hyphens, 3–100 chars"
  );

export const reviewPageSettingsPatchSchema = z.object({
  isPublic: z.boolean().optional(),
  slug: z.union([slugSchema, z.literal(""), z.null()]).optional(),
  pageTitle: z.string().max(255).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  showScores: z.boolean().optional(),
});
