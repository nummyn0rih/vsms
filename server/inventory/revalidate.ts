import { revalidatePath } from "next/cache";

// Дашборды остатков (/packaging, /ingredients) читают Σ движений на лету. Любое
// action, пишущее StockMovement, должно дёрнуть это — иначе router-cache отдаёт
// стейл (транзит-строки «В пути …» и завод не обновляются без хард-релоада).
export function revalidateStockDashboards() {
  revalidatePath("/packaging");
  revalidatePath("/ingredients");
}
