import { prisma } from "@/lib/prisma";
import { listNorms } from "@/server/norms/actions";
import type {
  CultureCol,
  FarmerRow,
  PackagingTypeCol,
} from "@/server/norms/schema";
import { NormsMatrix } from "./_components/NormsMatrix";
import { MultiTypeNormEditor } from "./_components/MultiTypeNormEditor";

// Грузим всё разом: фермеры (строки), культуры (колонки) с разрешёнными типами тары,
// оба набора норм и справочник типов тары (для редактора многотиповых культур).
export default async function NormsPage() {
  const [farmersRaw, culturesRaw, packagingTypes, packagingNorms, tripNorms] =
    await Promise.all([
      prisma.farmer.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.culture.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          color: true,
          packagingTypes: { select: { packaging_type_id: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.packagingType.findMany({
        where: { active: true },
        select: { id: true, name: true },
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
    packaging_type_ids: c.packagingTypes.map((pt) => pt.packaging_type_id),
  }));
  const packagingTypeCols: PackagingTypeCol[] = packagingTypes;

  return (
    <div className="grid gap-8">
      <NormsMatrix
        farmers={farmers}
        cultures={cultures}
        packagingNorms={packagingNorms}
        tripNorms={tripNorms}
      />
      <MultiTypeNormEditor
        farmers={farmers}
        cultures={cultures}
        packagingTypes={packagingTypeCols}
        packagingNorms={packagingNorms}
      />
    </div>
  );
}
