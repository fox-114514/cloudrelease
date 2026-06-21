import type { Device, DevicePermission, Image, User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors.js";

/**
 * Centralised authorization helpers used by route handlers. Each helper
 * returns a boolean or throws an AppError so handlers do not have to reason
 * about role strings inline.
 *
 * Tenant isolation is enforced via `ownerUserId`: any resource lookup that
 * might cross tenants must include this column in the WHERE clause.
 */

export interface RequestActor {
  ownerUserId: string;
  userId: string;
  role: string;
  /** Present only when authenticated via a device token. */
  deviceId?: string;
  permissions?: DevicePermission | null;
}

export function requireAnyAuth(request: FastifyRequest): RequestActor {
  if (request.user) {
    return {
      ownerUserId: request.user.ownerUserId,
      userId: request.user.userId,
      role: request.user.role,
    };
  }
  if (request.device) {
    return {
      ownerUserId: request.device.ownerUserId,
      userId: request.device.userId,
      role: request.device.role,
      deviceId: request.device.deviceId,
      permissions: request.device.permissions as unknown as DevicePermission,
    };
  }
  throw new AppError("UNAUTHORIZED", "Authentication required", 401);
}

export function requireUserAuth(request: FastifyRequest): {
  ownerUserId: string;
  userId: string;
  role: string;
} {
  if (!request.user) {
    throw new AppError("UNAUTHORIZED", "User authentication required", 401);
  }
  return {
    ownerUserId: request.user.ownerUserId,
    userId: request.user.userId,
    role: request.user.role,
  };
}

export function requireDeviceAuth(request: FastifyRequest): {
  deviceId: string;
  ownerUserId: string;
  userId: string;
  permissions: DevicePermission | null;
} {
  if (!request.device) {
    throw new AppError("DEVICE_AUTH_REQUIRED", "Device authentication required", 401);
  }
  return {
    deviceId: request.device.deviceId,
    ownerUserId: request.device.ownerUserId,
    userId: request.device.userId,
    permissions: request.device.permissions as unknown as DevicePermission,
  };
}

export function isOwnerUser(actor: Pick<RequestActor, "role">): boolean {
  return actor.role === "owner";
}

export function canManageSpace(actor: Pick<RequestActor, "deviceId" | "permissions">): boolean {
  if (!actor.deviceId) return false;
  return Boolean(actor.permissions?.canManageSpace);
}

/**
 * True when the actor is allowed to mutate the device record itself
 * (rename/revoke/delete). Owner user tokens can manage any device in the
 * space; child user tokens can only manage devices they own; canManageSpace
 * devices can manage any device; plain device tokens are forbidden.
 */
export function canManageDevice(actor: RequestActor, device: Pick<Device, "userId" | "ownerUserId">): boolean {
  if (actor.ownerUserId !== device.ownerUserId) return false;
  if (!actor.deviceId) {
    // User token path. Owner user tokens can manage anyone; child tokens
    // can only manage their own devices.
    return actor.role === "owner" || actor.userId === device.userId;
  }
  if (actor.permissions?.canManageSpace) return true;
  return false;
}

/**
 * Same matrix as canManageDevice but returns 404 (instead of 403) for child
 * users looking at other members' devices. The 404 vs 403 distinction is
 * deliberate: a child must not be able to enumerate device existence
 * across the space (spec §6.6).
 */
export function canManageOwnDeviceOrThrowNotFound(
  actor: RequestActor,
  device: Pick<Device, "userId" | "ownerUserId"> | null
): asserts device is Pick<Device, "userId" | "ownerUserId"> {
  if (!device || device.ownerUserId !== actor.ownerUserId) {
    throw new AppError("NOT_FOUND", "Device not found", 404);
  }
  if (actor.role === "owner") return;
  if (actor.deviceId && actor.permissions?.canManageSpace) return;
  if (!actor.deviceId && actor.userId === device.userId) return;
  throw new AppError("NOT_FOUND", "Device not found", 404);
}

/**
 * Whether the actor may modify a DevicePermission row. Owner user tokens
 * can change any field; canManageSpace devices can only mutate the runtime
 * fields listed in `MUTABLE_RUNTIME_FIELDS` (spec §6.7); plain device
 * tokens and child user tokens are forbidden entirely.
 */
export const MUTABLE_RUNTIME_FIELDS = [
  "canAutoUpload",
  "canManualUpload",
  "canAutoReceive",
  "canManualDownload",
  "autoUploadScope",
  "autoReceiveScope",
] as const;

export const PRIVILEGED_PERMISSION_FIELDS = ["canManageSpace", "canCreateInvite"] as const;

export type PermissionField = (typeof MUTABLE_RUNTIME_FIELDS)[number] | (typeof PRIVILEGED_PERMISSION_FIELDS)[number];

export function ensureCanModifyPermissions(
  actor: RequestActor,
  patch: Record<string, unknown>
): void {
  const requestedFields = Object.keys(patch);
  if (requestedFields.length === 0) return;

  const hasPrivileged = requestedFields.some((key) =>
    (PRIVILEGED_PERMISSION_FIELDS as readonly string[]).includes(key)
  );

  if (!actor.deviceId && actor.role === "owner") {
    // Owner user token can change every field, including the privileged
    // ones. Device tokens whose owning user happens to be "owner" do NOT
    // inherit this privilege — only `canManageSpace` matters for them.
    return;
  }

  if (actor.deviceId && actor.permissions?.canManageSpace) {
    // canManageSpace device cannot modify its own or others' privileged
    // permissions; doing so must produce a 403 instead of being silently
    // dropped (spec §6.7).
    if (hasPrivileged) {
      throw new AppError(
        "OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION",
        "Only owner user tokens can change canManageSpace or canCreateInvite",
        403
      );
    }
    for (const field of requestedFields) {
      if (!(MUTABLE_RUNTIME_FIELDS as readonly string[]).includes(field)) {
        throw new AppError(
          "OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION",
          `Field ${field} cannot be modified by a canManageSpace device`,
          403
        );
      }
    }
    return;
  }

  // Child users and plain device tokens cannot mutate permissions directly;
  // they must use the dedicated profile / receive-config endpoints.
  throw new AppError(
    "OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION",
    "Insufficient permission to modify device permissions",
    403
  );
}

/**
 * Authorization check for downloading an image. The matrix follows spec
 * §6.10:
 *
 * - owner / canManageSpace: allowed in their own space
 * - child user token: only their own uploads
 * - device with active delivery: allowed
 * - device with canManualDownload: only own user uploads
 * - everything else: 404 (so other members' images cannot be probed)
 */
export function canReadImage(
  actor: RequestActor,
  image: Pick<Image, "uploadUserId" | "ownerUserId">,
  deliveryExists: boolean
): boolean {
  if (actor.ownerUserId !== image.ownerUserId) return false;
  if (!actor.deviceId && actor.role === "owner") return true;
  if (actor.deviceId && actor.permissions?.canManageSpace) return true;
  if (!actor.deviceId) {
    // User token: only their own uploads.
    return actor.userId === image.uploadUserId;
  }
  if (deliveryExists) return true;
  if (actor.permissions?.canManualDownload && image.uploadUserId === actor.userId) {
    return true;
  }
  return false;
}

/**
 * Child user image-list filter helper. Returns the effective uploadUserId
 * that must be applied to a Prisma where-clause: it forces the requester's
 * own user id and silently ignores any client-supplied override (spec §6.9).
 */
export function resolveImageListFilter(
  actor: RequestActor,
  _requestedUserId?: string | null
): { ownerUserId: string; uploadUserId?: string } {
  if (!actor.deviceId && actor.role === "owner") {
    return { ownerUserId: actor.ownerUserId };
  }
  if (actor.deviceId && actor.permissions?.canManageSpace) {
    return { ownerUserId: actor.ownerUserId };
  }
  // Child users (and any other actor) are limited to their own uploads. If
  // they passed another userId we keep them strictly on their own images
  // instead of 403-ing, matching the recommended spec behaviour of being
  // friendly while still safe.
  return { ownerUserId: actor.ownerUserId, uploadUserId: actor.userId };
}

/**
 * Whether the actor may soft-delete an image. Child users are limited to
 * their own uploads; everyone else needs admin power. Device tokens are
 * never permitted to delete (spec §6.11) — even when they uploaded the
 * image — so callers should map a `false` result to 403 for device tokens
 * and 404 for child users.
 */
export function canDeleteImage(actor: RequestActor, image: Pick<Image, "uploadUserId" | "ownerUserId">): boolean {
  if (actor.ownerUserId !== image.ownerUserId) return false;
  if (!actor.deviceId && actor.role === "owner") return true;
  if (actor.deviceId && actor.permissions?.canManageSpace) return true;
  if (!actor.deviceId) {
    return actor.userId === image.uploadUserId;
  }
  return false;
}

export interface UserSummary {
  id: string;
  ownerUserId: string;
  role: string;
  displayName: string | null;
}

/** Light-weight, audit-safe user summary returned to clients. */
export function summarizeUser(user: Pick<User, "id" | "ownerUserId" | "role" | "displayName">): UserSummary {
  return {
    id: user.id,
    ownerUserId: user.ownerUserId,
    role: user.role,
    displayName: user.displayName,
  };
}