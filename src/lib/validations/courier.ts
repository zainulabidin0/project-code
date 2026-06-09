import { z } from "zod";

export const courierCompareRequestSchema = z.object({
  fromAddress: z.string().min(3).max(500),
  toAddress: z.string().min(3).max(500),
  weightKg: z.number().min(0.1).max(50),
  codAmount: z.number().min(0).max(500_000).optional(),
});

export type CourierCompareRequest = z.infer<typeof courierCompareRequestSchema>;
