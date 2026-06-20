-- CreateTable
CREATE TABLE "WeeklyPlanScope" (
    "id" SERIAL NOT NULL,
    "season_year" INTEGER NOT NULL,
    "iso_year" INTEGER NOT NULL,
    "iso_week" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,

    CONSTRAINT "WeeklyPlanScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyPlanScope_iso_year_iso_week_idx" ON "WeeklyPlanScope"("iso_year", "iso_week");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlanScope_week_culture_key" ON "WeeklyPlanScope"("iso_year", "iso_week", "culture_id");

-- AddForeignKey
ALTER TABLE "WeeklyPlanScope" ADD CONSTRAINT "WeeklyPlanScope_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
