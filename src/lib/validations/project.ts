import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().max(255).optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().max(255).optional(),
});
