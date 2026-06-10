import { z } from "zod";

import { phoneSchema } from "@/lib/validators";

// Единый источник валидации Driver. transport_company_id приходит строкой из
// Select; пустая = ошибка (DOMAIN.md §2: водитель без ТК недопустим).
export const driverSchema = z.object({
  full_name: z.string().trim().min(1, "ФИО обязательно"),
  phone: phoneSchema,
  transport_company_id: z.string().trim().min(1, "Компания обязательна"),
  info: z.string().trim().optional(),
});

export type DriverInput = z.infer<typeof driverSchema>;

// Вью-тип для клиентских компонентов (имя ТК резолвится из FK).
export type DriverRow = {
  id: number;
  full_name: string;
  phone: string;
  transport_company_id: number;
  transport_company_name: string | null;
  info: string | null;
  active: boolean;
};

export type { TransportCompanyOption } from "@/server/transport-companies/schema";
