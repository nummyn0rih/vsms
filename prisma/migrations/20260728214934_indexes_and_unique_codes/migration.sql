-- CreateIndex
CREATE INDEX "ChangeLog_entity_entity_id_idx" ON "ChangeLog"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialShipment_code_key" ON "MaterialShipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_code_key" ON "Shipment"("code");

-- CreateIndex
CREATE INDEX "Shipment_arrival_date_idx" ON "Shipment"("arrival_date");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipment_id_idx" ON "ShipmentItem"("shipment_id");

-- CreateIndex
CREATE INDEX "StockMovement_source_doc_type_source_doc_id_idx" ON "StockMovement"("source_doc_type", "source_doc_id");
