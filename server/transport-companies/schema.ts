import { z } from "zod";

// Единый источник валидации TransportCompany: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.
export const transportCompanySchema = z.object({
  name: z.string().trim().min(1, "Название обязательно"),
  notes: z.string().trim().optional(),
});

export type TransportCompanyInput = z.infer<typeof transportCompanySchema>;

// Вью-тип для клиентских компонентов.
export type TransportCompanyRow = {
  id: number;
  name: string;
  notes: string | null;
  active: boolean;
};

// Опция для FK-Select (форма водителя).
export type TransportCompanyOption = { id: number; name: string };
