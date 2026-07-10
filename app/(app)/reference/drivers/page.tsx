import { listDrivers } from "@/server/drivers/actions";
import { listTransportCompanyOptions } from "@/server/transport-companies/actions";
import type { DriverRow } from "@/server/drivers/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { DriverFormDialog } from "./_components/DriverFormDialog";
import { DriversTable } from "./_components/DriversTable";
import { CompanyFilter } from "./_components/CompanyFilter";
import { MobileDriversList } from "./_components/MobileDriversList";

// searchParams в Next 16 — асинхронный. Фильтры (поиск по фамилии + компания +
// неактивные) живут в URL и комбинируются. Страница перезапрашивает на сервере.
export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; company?: string; inactive?: string }>;
}) {
  const { q, company, inactive } = await searchParams;
  const companyId = company ? Number(company) : undefined;

  const [list, companyOptions] = await Promise.all([
    listDrivers({ q, companyId, includeInactive: inactive === "1" }),
    listTransportCompanyOptions(),
  ]);

  const rows: DriverRow[] = list.map((d) => ({
    id: d.id,
    full_name: d.full_name,
    phone: d.phone ?? "",
    transport_company_id: d.transport_company_id,
    transport_company_name: d.transportCompany?.name ?? null,
    info: d.info,
    active: d.active,
  }));

  return (
    <div>
      <div className="hidden md:block">
        <ReferenceToolbar
          searchPlaceholder="Поиск по фамилии…"
          filters={<CompanyFilter options={companyOptions} />}
        >
          <RoleGate allow={["admin"]}>
            <DriverFormDialog mode="create" companyOptions={companyOptions} />
          </RoleGate>
        </ReferenceToolbar>

        <DriversTable rows={rows} companyOptions={companyOptions} />
      </div>

      <div className="md:hidden">
        <MobileDriversList rows={rows} companyOptions={companyOptions} />
      </div>
    </div>
  );
}
