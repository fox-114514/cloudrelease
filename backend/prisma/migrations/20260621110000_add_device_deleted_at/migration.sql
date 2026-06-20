ALTER TABLE "devices" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "devices_owner_user_id_deleted_at_idx" ON "devices"("owner_user_id", "deleted_at");
