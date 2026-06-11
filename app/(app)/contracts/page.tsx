import {
  listContracts,
  listContractOptions,
} from "@/server/contracts/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { ContractFilters } from "./_components/ContractFilters";
import { ContractFormDialog } from "./_components/ContractFormDialog";
import { ContractsTable } from "./_components/ContractsTable";

// Фильтры (фермер, сезон) живут в URL и комбинируются. searchParams в Next 16 — async.
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ farmer?: string; season?: string }>;
}) {
  const { farmer, season } = await searchParams;

  const [rows, options] = await Promise.all([
    listContracts({
      farmerId: farmer ? Number(farmer) : undefined,
      season: season ? Number(season) : undefined,
    }),
    listContractOptions(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Контракты</h1>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <ContractFilters farmers={options.farmers} seasons={options.seasons} />
        <div className="ml-auto">
          <RoleGate allow={["admin"]}>
            <ContractFormDialog mode="create" {...options} />
          </RoleGate>
        </div>
      </div>

      <ContractsTable rows={rows} options={options} />
    </div>
  );
}
