import { AutoReceiveScope, AutoUploadScope, DevicePermission } from "@prisma/client";

/**
 * High-level device usage presets. These are intentionally separate from the
 * underlying DevicePermission columns so clients can present a small number of
 * human-readable choices instead of asking users to assemble six boolean
 * toggles. "custom" is only ever produced by `inferDeviceProfile` when the
 * persisted permission columns do not match any preset; clients are NOT
 * permitted to submit "custom" in a register or profile update request.
 */
export type DeviceProfile =
  | "manual_only"
  | "upload_only"
  | "receive_own"
  | "sync_own"
  | "custom";

export const SELECTABLE_DEVICE_PROFILES = [
  "manual_only",
  "upload_only",
  "receive_own",
  "sync_own",
] as const;

export type SelectableDeviceProfile = (typeof SELECTABLE_DEVICE_PROFILES)[number];

export const DEVICE_PROFILE_VALUES: readonly DeviceProfile[] = [
  ...SELECTABLE_DEVICE_PROFILES,
  "custom",
];

/**
 * Runtime patch for the six permission columns a profile is allowed to set.
 * Profile updates deliberately do NOT touch canManualDownload, canManageSpace
 * or canCreateInvite: those are privileged fields with separate change
 * controls (see spec §6.7).
 */
export interface RuntimePermissionPatch {
  canAutoUpload: boolean;
  canManualUpload: boolean;
  canAutoReceive: boolean;
  autoUploadScope: AutoUploadScope;
  autoReceiveScope: AutoReceiveScope;
}

interface ProfileDefinition {
  readonly canAutoUpload: boolean;
  readonly canManualUpload: boolean;
  readonly canAutoReceive: boolean;
  readonly autoUploadScope: AutoUploadScope;
  readonly autoReceiveScope: AutoReceiveScope;
}

const PROFILE_DEFINITIONS: { readonly [K in SelectableDeviceProfile]: ProfileDefinition } = {
  manual_only: {
    canAutoUpload: false,
    canManualUpload: true,
    canAutoReceive: false,
    autoUploadScope: "manual_share_only",
    autoReceiveScope: "disabled",
  },
  upload_only: {
    canAutoUpload: true,
    canManualUpload: true,
    canAutoReceive: false,
    autoUploadScope: "screenshot_only",
    autoReceiveScope: "disabled",
  },
  receive_own: {
    canAutoUpload: false,
    canManualUpload: true,
    canAutoReceive: true,
    autoUploadScope: "manual_share_only",
    autoReceiveScope: "same_user_only",
  },
  sync_own: {
    canAutoUpload: true,
    canManualUpload: true,
    canAutoReceive: true,
    autoUploadScope: "screenshot_only",
    autoReceiveScope: "same_user_only",
  },
} satisfies { readonly [K in SelectableDeviceProfile]: ProfileDefinition };

/**
 * The legacy default values used by pre-0.5.x clients. These are kept
 * verbatim so omitting the `profile` field during registration remains
 * backwards compatible. New clients are expected to call
 * `inferDeviceProfile` on these defaults and see "custom".
 */
export const LEGACY_DEFAULT_PROFILE: RuntimePermissionPatch = {
  canAutoUpload: false,
  canManualUpload: true,
  canAutoReceive: false,
  autoUploadScope: "screenshot_only",
  autoReceiveScope: "disabled",
};

/**
 * Resolve the runtime permission patch for a selectable profile. The returned
 * object is a fresh copy: callers may persist it without worrying about
 * shared references.
 */
export function permissionsForProfile(profile: SelectableDeviceProfile): RuntimePermissionPatch {
  const def = PROFILE_DEFINITIONS[profile];
  return {
    canAutoUpload: def.canAutoUpload,
    canManualUpload: def.canManualUpload,
    canAutoReceive: def.canAutoReceive,
    autoUploadScope: def.autoUploadScope,
    autoReceiveScope: def.autoReceiveScope,
  };
}

/**
 * Type guard for selectable profiles. Rejects "custom" submissions, matching
 * spec §5.2: only the four high-level presets are accepted from clients.
 */
export function isSelectableDeviceProfile(value: string): value is SelectableDeviceProfile {
  return (SELECTABLE_DEVICE_PROFILES as readonly string[]).includes(value);
}

interface InferablePermissionShape {
  canAutoUpload: boolean;
  canManualUpload: boolean;
  canAutoReceive: boolean;
  autoUploadScope: AutoUploadScope | string;
  autoReceiveScope: AutoReceiveScope | string;
}

/**
 * Best-effort inverse of `permissionsForProfile`. Returns "custom" when the
 * persisted columns do not match any selectable profile; this lets the UI
 * display "自定义" rather than silently rewriting the user's settings.
 */
export function inferDeviceProfile(
  permission: InferablePermissionShape | DevicePermission | null | undefined
): DeviceProfile {
  if (!permission) return "custom";

  for (const profile of SELECTABLE_DEVICE_PROFILES) {
    const def = PROFILE_DEFINITIONS[profile];
    if (
      permission.canAutoUpload === def.canAutoUpload &&
      permission.canManualUpload === def.canManualUpload &&
      permission.canAutoReceive === def.canAutoReceive &&
      permission.autoUploadScope === def.autoUploadScope &&
      permission.autoReceiveScope === def.autoReceiveScope
    ) {
      return profile;
    }
  }

  return "custom";
}