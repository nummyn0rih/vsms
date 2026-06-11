import { prisma } from "@/lib/prisma";
import { listNorms } from "@/server/norms/actions";
import type { CultureCol, FarmerRow } from "@/server/norms/schema";
import { NormsMatrix } from "./_components/NormsMatrix";

// Грузим всё разом: фермеры (строки), культуры (колонки) и ОБА набора норм.
// Переключение режима — клиентское, без рефетча.
export default async function NormsPage() {
  const [farmersRaw, culturesRaw, packagingNorms, tripNorms] = await Promise.all([
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.culture.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true, packaging_type_id: true },
      orderBy: { name: "asc" },
    }),
    listNorms("packaging"),
    listNorms("trip"),
  ]);

  const farmers: FarmerRow[] = farmersRaw;
  const cultures: CultureCol[] = culturesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    has_packaging: c.packaging_type_id != null,
  }));

  return (
    <NormsMatrix
      farmers={farmers}
      cultures={cultures}
      packagingNorms={packagingNorms}
      tripNorms={tripNorms}
    />
  );
}
