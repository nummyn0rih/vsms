import { listTransportCompanies } from "@/server/transport-companies/actions";
import type { TransportCompanyRow } from "@/server/transport-companies/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { TransportCompanyFormDialog } from "./_components/TransportCompanyFormDialog";
import { TransportCompaniesTable } from "./_components/TransportCompaniesTable";

// searchParams в Next 16 — асинхронный. Фильтры живут в URL, страница
// перезапрашивает данные на сервере при их изменении.
export default async function TransportCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const { q, inactive } = await searchParams;
  const list = await listTransportCompanies({
    q,
    includeInactive: inactive === "1",
  });

  const rows: TransportCompanyRow[] = list;

  return (
    <div>
      <ReferenceToolbar searchPlaceholder="Поиск по названию…">
        <RoleGate allow={["admin"]}>
          <TransportCompanyFormDialog mode="create" />
        </RoleGate>
      </ReferenceToolbar>

      <TransportCompaniesTable rows={rows} />
    </div>
  );
}
