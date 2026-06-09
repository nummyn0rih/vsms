import { listFarmers } from "@/server/farmers/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { FarmerFormDialog } from "./_components/FarmerFormDialog";
import { FarmersTable } from "./_components/FarmersTable";

// searchParams в Next 16 — асинхронный. Фильтры живут в URL, страница
// перезапрашивает данные на сервере при их изменении.
export default async function FarmersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const { q, inactive } = await searchParams;
  const farmers = await listFarmers({
    q,
    includeInactive: inactive === "1",
  });

  return (
    <div>
      <ReferenceToolbar>
        <RoleGate allow={["admin"]}>
          <FarmerFormDialog mode="create" />
        </RoleGate>
      </ReferenceToolbar>

      <FarmersTable farmers={farmers} />
    </div>
  );
}
