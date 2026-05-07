import { z } from "zod";

const optionsSchema = z
  .object({
    regexOnly: z.boolean().optional(),
    format: z.enum(["standard"]).optional(),
    includeMetadata: z.boolean().optional(),
  })
  .optional();

export const correctRequestSchema = z.object({
  address: z.string().min(1).max(1000),
  options: optionsSchema,
});

export const correctBatchSchema = z.object({
  addresses: z
    .array(z.string().min(1).max(1000))
    .min(1)
    .max(50),
  options: optionsSchema,
});
