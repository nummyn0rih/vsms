import { listPackagingTypes } from "@/server/packaging-types/actions";
import type { PackagingTypeRow } from "@/server/packaging-types/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { PackagingTypeFormDialog } from "./_components/PackagingTypeFormDialog";
import { PackagingTypesTable } from "./_components/PackagingTypesTable";

// searchParams в Next 16 — асинхронный. Фильтры живут в URL, страница
// перезапрашивает данные на сервере при их изменении.
export default async function PackagingTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const { q, inactive } = await searchParams;
  const list = await listPackagingTypes({ q, includeInactive: inactive === "1" });

  // Prisma.Decimal не сериализуется в Client Component — отдаём number | null.
  const rows: PackagingTypeRow[] = list.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    capacity_kg: p.capacity_kg == null ? null : Number(p.capacity_kg),
    active: p.active,
  }));

  return (
    <div>
      <ReferenceToolbar searchPlaceholder="Поиск по названию…">
        <RoleGate allow={["admin"]}>
          <PackagingTypeFormDialog mode="create" />
        </RoleGate>
      </ReferenceToolbar>

      <PackagingTypesTable rows={rows} />
    </div>
  );
}
