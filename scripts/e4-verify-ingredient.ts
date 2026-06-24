import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../lib/generated/prisma/client";

// E4: проверка витрины остатков ингредиентов (getIngredientBalances/Movements).
// Вставляем движения (opening/delivery/consumption) и считаем Σ ТОЙ ЖЕ логикой,
// что getIngredientBalances (+to / −from, null-сторона пропускается). Всё в одной
// $transaction с финальным throw — БД не меняется. Запуск: npx tsx scripts/e4-verify-ingredient.ts
dns.setDefaultResultOrder("ipv4first");

const FACTORY = 0;
const TRANSIT = -2; // TRANSIT_TO_FARMER

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Move = {
  ingredient_id: number;
  quantity: Prisma.Decimal;
  from_location_id: number | null;
  to_location_id: number | null;
  movement_type: string;
};

// Σ движений по локациям для одного ингредиента — копия логики getIngredientBalances.
function net(moves: Move[], ing: number): Map<number, number> {
  const m = new Map<number, number>();
  const add = (loc: number | null, d: number) => {
    if (loc == null) return;
    m.set(loc, (m.get(loc) ?? 0) + d);
  };
  for (const mv of moves) {
    if (mv.ingredient_id !== ing) continue;
    const q = Number(mv.quantity);
    add(mv.to_location_id, q);
    add(mv.from_location_id, -q);
  }
  return m;
}
const systemTotal = (moves: Move[], ing: number) =>
  [...net(moves, ing).values()].reduce((s, v) => s + v, 0);

// Чип по movement_type — копия chipForIngredient.
function chip(mv: Move): string {
  switch (mv.movement_type) {
    case "opening":
      return "остаток на начало";
    case "delivery":
      if (mv.from_location_id === FACTORY && mv.to_location_id === TRANSIT) return "отправлено";
      if (mv.from_location_id === TRANSIT && mv.to_location_id === FACTORY) return "сторно отправки";
      if (mv.from_location_id === TRANSIT) return "доставка";
      if (mv.to_location_id === TRANSIT) return "сторно доставки";
      return "доставка";
    case "consumption":
      return mv.to_location_id == null ? "расход в производство" : "сторно расхода";
    default:
      return mv.movement_type;
  }
}

async function main() {
  try {
    await prisma.$transaction(
      async (tx) => {
        const fX = await tx.farmer.findFirst({ where: { active: true }, orderBy: { id: "asc" } });
        const driver = await tx.driver.findFirst();
        if (!fX || !driver) throw new Error("Нужен активный фермер и водитель в БД");

        let salt = await tx.ingredient.findFirst({ where: { active: true, unit: "kg" } });
        if (!salt) salt = await tx.ingredient.create({ data: { name: "Соль (тест)", unit: "kg" } });
        let vinegar = await tx.ingredient.findFirst({ where: { active: true, unit: "l" } });
        if (!vinegar) vinegar = await tx.ingredient.create({ data: { name: "Уксус (тест)", unit: "l" } });

        // Рейс — для резолва кода источника (Рейс <code>).
        const trip = await tx.materialShipment.create({
          data: { code: "E4-T1", status: "planned", driver_id: driver.id },
        });

        const moves: Move[] = [];
        async function mk(data: {
          ingredient_id: number;
          quantity: string;
          from_location_id: number | null;
          to_location_id: number | null;
          movement_type: "opening" | "delivery" | "consumption";
          source_doc_type: "manual" | "material_shipment" | "acceptance_act";
          source_doc_id: number | null;
        }) {
          await tx.stockMovement.create({
            data: {
              kind: "ingredient",
              ingredient_id: data.ingredient_id,
              quantity: data.quantity,
              from_location_id: data.from_location_id,
              to_location_id: data.to_location_id,
              movement_type: data.movement_type as never,
              source_doc_type: data.source_doc_type as never,
              source_doc_id: data.source_doc_id,
            },
          });
          moves.push({
            ingredient_id: data.ingredient_id,
            quantity: new Prisma.Decimal(data.quantity),
            from_location_id: data.from_location_id,
            to_location_id: data.to_location_id,
            movement_type: data.movement_type,
          });
        }

        const locs = [
          { label: "завод", id: FACTORY },
          { label: `ферм#${fX.id}`, id: fX.id },
          { label: "транз-2", id: TRANSIT },
        ];
        const fmt = (n: Map<number, number>) =>
          locs.map((l) => `${l.label}=${n.get(l.id) ?? 0}`).join(" · ");

        // ===== 1. БАЗА: opening 100 → доставка 30 (send+arrive) → расход 12 =====
        console.log("=== 1. БАЗА (соль, кг): opening 100 · доставка 30 фермеру X · расход 12 ===");
        await mk({ ingredient_id: salt.id, quantity: "100", from_location_id: null, to_location_id: FACTORY, movement_type: "opening", source_doc_type: "manual", source_doc_id: null });
        await mk({ ingredient_id: salt.id, quantity: "30", from_location_id: FACTORY, to_location_id: TRANSIT, movement_type: "delivery", source_doc_type: "material_shipment", source_doc_id: trip.id });
        await mk({ ingredient_id: salt.id, quantity: "30", from_location_id: TRANSIT, to_location_id: fX.id, movement_type: "delivery", source_doc_type: "material_shipment", source_doc_id: trip.id });
        await mk({ ingredient_id: salt.id, quantity: "12", from_location_id: fX.id, to_location_id: null, movement_type: "consumption", source_doc_type: "acceptance_act", source_doc_id: 999 });
        const n1 = net(moves, salt.id);
        console.log("остатки:    ", fmt(n1), "(ожид. завод=70 · ферм=18 · транз=0)");
        console.log(`итого соль: ${systemTotal(moves, salt.id)} кг (ожид. 88 = 100 − 12 расход)`);
        console.log("  ⚠ 88 ≠ 100 (opening): расход 12 ушёл ИЗ системы — это норма, не потеря учёта.");

        // ===== 2. В ПУТИ: новая доставка отправлена, не прибыла =====
        console.log("\n=== 2. В ПУТИ (соль +20 отправлено, не прибыло) ===");
        await mk({ ingredient_id: salt.id, quantity: "20", from_location_id: FACTORY, to_location_id: TRANSIT, movement_type: "delivery", source_doc_type: "material_shipment", source_doc_id: trip.id });
        console.log("после send: ", fmt(net(moves, salt.id)), "(ожид. транз=20 · завод=50)");
        await mk({ ingredient_id: salt.id, quantity: "20", from_location_id: TRANSIT, to_location_id: fX.id, movement_type: "delivery", source_doc_type: "material_shipment", source_doc_id: trip.id });
        console.log("после arr:  ", fmt(net(moves, salt.id)), "(ожид. транз=0 · ферм=38)");

        // ===== 3. ОТРИЦАТЕЛЬНЫЙ: расход у фермера до доставки (уксус, л) =====
        console.log("\n=== 3. ОТРИЦАТЕЛЬНЫЙ (уксус, л): расход 5 у фермера X без прибытия ===");
        await mk({ ingredient_id: vinegar.id, quantity: "5", from_location_id: fX.id, to_location_id: null, movement_type: "consumption", source_doc_type: "acceptance_act", source_doc_id: 999 });
        const nv = net(moves, vinegar.id);
        console.log("уксус:      ", fmt(nv), "(ожид. ферм=-5 — показывается как есть)");

        // ===== 4. ДВЕ ЕДИНИЦЫ: межколоночного итога нет =====
        console.log("\n=== 4. ДВЕ ЕДИНИЦЫ (раздельный итог) ===");
        console.log(`  соль:   итого ${systemTotal(moves, salt.id)} кг`);
        console.log(`  уксус:  итого ${systemTotal(moves, vinegar.id)} л`);
        console.log("  (кг и л НЕ суммируются — каждая колонка своя единица)");

        // ===== 5. DRILL-DOWN: история соли у фермера X (знак + чип + источник) =====
        console.log("\n=== 5. DRILL-DOWN: соль у фермера X (signed qty + чип + источник) ===");
        for (const mv of moves.filter((m) => m.ingredient_id === salt.id)) {
          let signed = 0;
          if (mv.to_location_id === fX.id) signed += Number(mv.quantity);
          if (mv.from_location_id === fX.id) signed -= Number(mv.quantity);
          if (signed === 0) continue; // не касается ячейки фермера X
          const src =
            mv.movement_type === "consumption" ? "Акт #999"
            : mv.movement_type === "delivery" ? `Рейс ${trip.code}`
            : "Инвентаризация склада";
          console.log(`  ${signed > 0 ? "+" + signed : signed}\tкг\t[${chip(mv)}]\t${src}`);
        }

        throw new Rollback();
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (e instanceof Rollback) {
      console.log("\n✓ Транзакция откачена (БД не изменена).");
    } else {
      throw e;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
