import { z } from "zod";

// Единый источник валидации Farmer: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.
export const farmerSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно"),
  contacts: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type FarmerInput = z.infer<typeof farmerSchema>;
