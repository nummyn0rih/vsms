-- B4a: гранулярность плана день/неделя (BR-20/21). season_year + nullable date +
-- partial-unique индексы (Prisma 7.4+ partialIndexes). Старый общий unique снят.
-- DropIndex
DROP INDEX "WeeklyPlan_iso_year_iso_week_culture_id_key";

-- AlterTable
ALTER TABLE "WeeklyPlan" ADD COLUMN     "date" DATE,
ADD COLUMN     "season_year" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlan_date_culture_key" ON "WeeklyPlan"("date", "culture_id") WHERE ("date" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlan_week_culture_key" ON "WeeklyPlan"("iso_year", "iso_week", "culture_id") WHERE ("date" IS NULL);
