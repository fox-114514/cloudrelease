-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('owner', 'child');

-- CreateEnum
CREATE TYPE "platform" AS ENUM ('android', 'windows', 'linux');

-- CreateEnum
CREATE TYPE "auto_upload_scope" AS ENUM ('screenshot_only', 'selected_album', 'manual_share_only', 'all_images');

-- CreateEnum
CREATE TYPE "auto_receive_scope" AS ENUM ('disabled', 'all_authorized_sources', 'same_user_only', 'selected_devices');

-- CreateEnum
CREATE TYPE "image_source_kind" AS ENUM ('screenshot', 'manual_share', 'selected_album', 'unknown');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'notified', 'downloaded', 'failed', 'skipped', 'expired');

-- CreateEnum
CREATE TYPE "bind_purpose" AS ENUM ('bind_device', 'invite_child_user');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "display_name" TEXT,
    "email_or_login" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "platform" NOT NULL,
    "app_version" TEXT NOT NULL,
    "os_version" TEXT NOT NULL,
    "device_token_hash" TEXT NOT NULL,
    "public_key" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_permissions" (
    "device_id" TEXT NOT NULL,
    "can_auto_upload" BOOLEAN NOT NULL DEFAULT false,
    "can_manual_upload" BOOLEAN NOT NULL DEFAULT false,
    "can_auto_receive" BOOLEAN NOT NULL DEFAULT false,
    "can_manual_download" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_space" BOOLEAN NOT NULL DEFAULT false,
    "can_create_invite" BOOLEAN NOT NULL DEFAULT false,
    "auto_upload_scope" "auto_upload_scope" NOT NULL DEFAULT 'screenshot_only',
    "auto_receive_scope" "auto_receive_scope" NOT NULL DEFAULT 'disabled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_permissions_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "receive_source_rules" (
    "target_device_id" TEXT NOT NULL,
    "source_device_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receive_source_rules_pkey" PRIMARY KEY ("target_device_id","source_device_id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "upload_user_id" TEXT NOT NULL,
    "upload_device_id" TEXT NOT NULL,
    "origin_image_id" TEXT,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storage_key" TEXT NOT NULL,
    "source_kind" "image_source_kind" NOT NULL DEFAULT 'unknown',
    "source_display_name" TEXT,
    "source_media_id_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "image_id" TEXT NOT NULL,
    "target_device_id" TEXT NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "notified_at" TIMESTAMP(3),
    "downloaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bind_codes" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "bind_purpose" NOT NULL,
    "target_role" "user_role",
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bind_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_device_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_or_login_key" ON "users"("email_or_login");

-- CreateIndex
CREATE INDEX "users_owner_user_id_idx" ON "users"("owner_user_id");

-- CreateIndex
CREATE INDEX "users_email_or_login_idx" ON "users"("email_or_login");

-- CreateIndex
CREATE INDEX "groups_owner_user_id_idx" ON "groups"("owner_user_id");

-- CreateIndex
CREATE INDEX "group_members_user_id_idx" ON "group_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_token_hash_key" ON "devices"("device_token_hash");

-- CreateIndex
CREATE INDEX "devices_owner_user_id_idx" ON "devices"("owner_user_id");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "receive_source_rules_source_device_id_idx" ON "receive_source_rules"("source_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "images_storage_key_key" ON "images"("storage_key");

-- CreateIndex
CREATE INDEX "images_owner_user_id_idx" ON "images"("owner_user_id");

-- CreateIndex
CREATE INDEX "images_upload_device_id_idx" ON "images"("upload_device_id");

-- CreateIndex
CREATE INDEX "images_sha256_idx" ON "images"("sha256");

-- CreateIndex
CREATE INDEX "images_expires_at_idx" ON "images"("expires_at");

-- CreateIndex
CREATE INDEX "deliveries_target_device_id_status_idx" ON "deliveries"("target_device_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_image_id_idx" ON "deliveries"("image_id");

-- CreateIndex
CREATE UNIQUE INDEX "bind_codes_code_hash_key" ON "bind_codes"("code_hash");

-- CreateIndex
CREATE INDEX "bind_codes_owner_user_id_idx" ON "bind_codes"("owner_user_id");

-- CreateIndex
CREATE INDEX "bind_codes_expires_at_idx" ON "bind_codes"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_owner_user_id_idx" ON "audit_logs"("owner_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_device_id_idx" ON "audit_logs"("actor_device_id");

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_permissions" ADD CONSTRAINT "device_permissions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receive_source_rules" ADD CONSTRAINT "receive_source_rules_target_device_id_fkey" FOREIGN KEY ("target_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receive_source_rules" ADD CONSTRAINT "receive_source_rules_source_device_id_fkey" FOREIGN KEY ("source_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_upload_user_id_fkey" FOREIGN KEY ("upload_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_upload_device_id_fkey" FOREIGN KEY ("upload_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_target_device_id_fkey" FOREIGN KEY ("target_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bind_codes" ADD CONSTRAINT "bind_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bind_codes" ADD CONSTRAINT "bind_codes_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bind_codes" ADD CONSTRAINT "bind_codes_used_by_device_id_fkey" FOREIGN KEY ("used_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_device_id_fkey" FOREIGN KEY ("actor_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
