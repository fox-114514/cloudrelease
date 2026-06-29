-- Add a unique constraint on (image_id, target_device_id) so even a future
-- retry or concurrent caller of generateDeliveries can never produce two
-- pending deliveries for the same (image, target) pair. Existing duplicates,
-- if any, are removed first so the index creation cannot fail on production
-- data that may have been inserted before this guard existed.
DELETE FROM "deliveries" d1 USING "deliveries" d2
WHERE d1.id < d2.id
  AND d1.image_id = d2.image_id
  AND d1.target_device_id = d2.target_device_id;

CREATE UNIQUE INDEX "deliveries_image_id_target_device_id_key"
  ON "deliveries"("image_id", "target_device_id");
