import { z } from "zod";

import { phoneSchema } from "@/lib/validators";

// Единый источник валидации Farmer: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.

// contacts — структура, не плоская строка. phone обязателен ⇒ contacts обязателен.
export const contactsSchema = z.object({
  phone: phoneSchema,
  contactPerson: z.string().trim().optional(),
  messenger: z.string().trim().optional(),
  // Пустая строка из формы допустима (поле необязательное), иначе — валидный email.
  email: z.union([z.literal(""), z.email("Неверный email")]).optional(),
});

export const farmerSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно"),
  contacts: contactsSchema,
  notes: z.string().trim().optional(),
});

export type FarmerInput = z.infer<typeof farmerSchema>;
export type FarmerContacts = z.infer<typeof contactsSchema>;
