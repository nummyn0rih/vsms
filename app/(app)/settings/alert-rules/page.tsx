import { listAlertRules, listOptions } from "@/server/alert-rules/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { AlertRuleFormDialog } from "./_components/AlertRuleFormDialog";
import { AlertRulesTable } from "./_components/AlertRulesTable";

export default async function AlertRulesPage() {
  const [rows, options] = await Promise.all([listAlertRules(), listOptions()]);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <RoleGate allow={["admin"]}>
          <AlertRuleFormDialog mode="create" options={options} />
        </RoleGate>
      </div>

      <AlertRulesTable rows={rows} options={options} />
    </div>
  );
}
