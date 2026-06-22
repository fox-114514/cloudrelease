/**
 * Multi-user configuration auditor (spec §16).
 *
 * Reads-only by default. When --apply-safe-fixes is passed, will:
 *   - Mark selected_devices receivers with no source rules as
 *     canAutoReceive=false + autoReceiveScope=disabled.
 *   - Expire unredeemed bind codes belonging to disabled users.
 *
 * The script NEVER revokes canManageSpace from a child-owned device
 * automatically; owners must make that decision after review.
 *
 * Usage:
 *   tsx src/scripts/audit-multi-user-config.ts                # read-only
 *   tsx src/scripts/audit-multi-user-config.ts --apply-safe-fixes
 */

import { prisma } from "../lib/prisma.js";

interface Finding {
  category: string;
  severity: "info" | "warning";
  ownerUserId: string;
  message: string;
  targetId?: string;
}

async function collectFindings(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // canAutoReceive=true + scope=disabled is a meaningless combination that
  // silently wastes bandwidth / observer CPU on the receiver side.
  const enabledButDisabled = await prisma.devicePermission.findMany({
    where: { canAutoReceive: true, autoReceiveScope: "disabled" },
    include: { device: { select: { id: true, ownerUserId: true, name: true, userId: true } } },
  });
  for (const row of enabledButDisabled) {
    findings.push({
      category: "enabled_but_disabled",
      severity: "warning",
      ownerUserId: row.device.ownerUserId,
      message: `Device "${row.device.name}" has canAutoReceive=true with scope=disabled`,
      targetId: row.device.id,
    });
  }

  // selected_devices with no actual source rules.
  const selectedDevices = await prisma.device.findMany({
    where: {
      deletedAt: null,
      revokedAt: null,
      permissions: { autoReceiveScope: "selected_devices" },
    },
    include: { permissions: true, receiveRulesAsTarget: true },
  });
  for (const device of selectedDevices) {
    if (device.receiveRulesAsTarget.length === 0) {
      findings.push({
        category: "selected_devices_no_sources",
        severity: "warning",
        ownerUserId: device.ownerUserId,
        message: `Device "${device.name}" is selected_devices but has zero source rules`,
        targetId: device.id,
      });
    }
  }

  // child user owns a device with canManageSpace=true.
  const childAdmins = await prisma.device.findMany({
    where: {
      deletedAt: null,
      revokedAt: null,
      permissions: { canManageSpace: true },
      user: { role: "child" },
    },
    include: { user: { select: { displayName: true, emailOrLogin: true } } },
  });
  for (const device of childAdmins) {
    const who = device.user.displayName || device.user.emailOrLogin || device.userId;
    findings.push({
      category: "child_can_manage_space",
      severity: "warning",
      ownerUserId: device.ownerUserId,
      message: `Device "${device.name}" owned by child "${who}" has canManageSpace=true (requires owner review)`,
      targetId: device.id,
    });
  }

  // canManualDownload=true on a child-owned device. Allowed but flagged for
  // owner awareness: with V2 tightening this no longer crosses members.
  const childManualDownload = await prisma.device.findMany({
    where: {
      deletedAt: null,
      revokedAt: null,
      permissions: { canManualDownload: true },
      user: { role: "child" },
    },
    include: { user: { select: { displayName: true, emailOrLogin: true } } },
  });
  for (const device of childManualDownload) {
    const who = device.user.displayName || device.user.emailOrLogin || device.userId;
    findings.push({
      category: "child_can_manual_download",
      severity: "info",
      ownerUserId: device.ownerUserId,
      message: `Device "${device.name}" owned by child "${who}" has canManualDownload=true (no longer crosses members)`,
      targetId: device.id,
    });
  }

  // Unredeemed bind codes for disabled users.
  const orphanedCodes = await prisma.bindCode.findMany({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
      targetUser: { disabledAt: { not: null } },
    },
    include: {
      targetUser: { select: { displayName: true, emailOrLogin: true } },
    },
  });
  for (const code of orphanedCodes) {
    const who = code.targetUser.displayName || code.targetUser.emailOrLogin || code.targetUserId;
    findings.push({
      category: "orphan_bind_code",
      severity: "info",
      ownerUserId: code.ownerUserId,
      message: `Bind code for disabled user "${who}" is still unredeemed`,
      targetId: code.id,
    });
  }

  return findings;
}

async function applySafeFixes(findings: Finding[]): Promise<{ patched: number; expired: number }> {
  let patched = 0;
  let expired = 0;

  const selectedNoSources = findings.filter((f) => f.category === "selected_devices_no_sources");
  for (const f of selectedNoSources) {
    if (!f.targetId) continue;
    const result = await prisma.devicePermission.updateMany({
      where: {
        deviceId: f.targetId,
        autoReceiveScope: "selected_devices",
      },
      data: { canAutoReceive: false, autoReceiveScope: "disabled" },
    });
    patched += result.count;
  }

  const orphanCodes = findings.filter((f) => f.category === "orphan_bind_code");
  for (const f of orphanCodes) {
    if (!f.targetId) continue;
    const result = await prisma.bindCode.updateMany({
      where: { id: f.targetId, usedAt: null },
      data: { expiresAt: new Date() },
    });
    expired += result.count;
  }

  return { patched, expired };
}

function printFindings(findings: Finding[]): void {
  const grouped: Record<string, Finding[]> = {};
  for (const f of findings) {
    grouped[f.category] = grouped[f.category] ?? [];
    grouped[f.category].push(f);
  }

  const labels: Record<string, string> = {
    enabled_but_disabled: "可以自动接收但范围 disabled(无效组合)",
    selected_devices_no_sources: "selected_devices 但没有来源设备",
    child_can_manage_space: "成员名下设备持有 canManageSpace",
    child_can_manual_download: "成员名下设备 canManualDownload=true",
    orphan_bind_code: "已禁用成员的未使用绑定码",
  };

  if (findings.length === 0) {
    console.log("未发现需要处理的多用户配置风险。");
    return;
  }

  console.log(`发现 ${findings.length} 项多用户配置风险:`);
  for (const [category, items] of Object.entries(grouped)) {
    console.log(`\n[${category}] ${labels[category] ?? category} (${items.length})`);
    for (const item of items) {
      const prefix = item.severity === "warning" ? "⚠️ " : "·  ";
      console.log(`  ${prefix}space=${item.ownerUserId.slice(0, 8)}…  ${item.message}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply-safe-fixes");

  const findings = await collectFindings();
  printFindings(findings);

  if (!apply) {
    console.log("\n只读模式完成。带 --apply-safe-fixes 可应用安全修复(selected_devices → disabled、过期禁用成员的绑定码)。");
    return;
  }

  console.log("\n正在应用安全修复...");
  const result = await applySafeFixes(findings);
  console.log(`已修复 ${result.patched} 个 selected_devices 配置和 ${result.expired} 个过期绑定码。`);
  console.log("其他类别需要 owner 人工处理,未自动变更。");
}

main()
  .catch((err) => {
    console.error("审计脚本执行失败:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });