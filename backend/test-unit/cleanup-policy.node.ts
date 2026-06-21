import assert from "node:assert/strict";
import { test } from "vitest";
import {
  executeImageCleanup,
  type CleanupDependencies,
  type CleanupImageRef,
} from "../src/services/cleanup-policy.js";

const NOW = new Date("2026-06-21T12:00:00.000Z");

function createDependencies(options: {
  newlyExpired?: CleanupImageRef[];
  purgeCandidates?: CleanupImageRef[];
  failStorageKeys?: Set<string>;
  failHardDeleteIds?: Set<string>;
}) {
  const deletedStorageKeys: string[] = [];
  const hardDeletedImageIds: string[] = [];
  const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = [];
  let cutoff: Date | undefined;

  const dependencies: CleanupDependencies = {
    markExpired: async () => options.newlyExpired?.length ?? 0,
    findNewlyDeleted: async () => options.newlyExpired ?? [],
    findDeletedBefore: async (value) => {
      cutoff = value;
      return options.purgeCandidates ?? [];
    },
    deleteStoredImage: async (storageKey) => {
      deletedStorageKeys.push(storageKey);
      if (options.failStorageKeys?.has(storageKey)) {
        throw new Error("simulated filesystem failure");
      }
    },
    hardDeleteImage: async (imageId) => {
      hardDeletedImageIds.push(imageId);
      if (options.failHardDeleteIds?.has(imageId)) {
        throw new Error("simulated database failure");
      }
      return true;
    },
    warn: (message, metadata) => warnings.push({ message, metadata }),
  };

  return {
    dependencies,
    deletedStorageKeys,
    hardDeletedImageIds,
    warnings,
    getCutoff: () => cutoff,
  };
}

test("deletes storage immediately for newly expired images", async () => {
  const context = createDependencies({
    newlyExpired: [
      { id: "new-1", storageKey: "images/new-1.png" },
      { id: "new-2", storageKey: "images/new-2.png" },
    ],
  });

  const stats = await executeImageCleanup(context.dependencies, NOW);

  assert.deepEqual(context.deletedStorageKeys, ["images/new-1.png", "images/new-2.png"]);
  assert.deepEqual(context.hardDeletedImageIds, []);
  assert.equal(stats.newlyExpired, 2);
  assert.equal(stats.immediateStorageDeletes, 2);
  assert.equal(stats.storageDeleteFailures, 0);
});

test("keeps an old database row when storage deletion fails", async () => {
  const context = createDependencies({
    purgeCandidates: [{ id: "old-1", storageKey: "images/old-1.png" }],
    failStorageKeys: new Set(["images/old-1.png"]),
  });

  const stats = await executeImageCleanup(context.dependencies, NOW);

  assert.deepEqual(context.hardDeletedImageIds, []);
  assert.equal(stats.hardDeleted, 0);
  assert.equal(stats.storageDeleteFailures, 1);
  assert.equal(context.warnings.length, 1);
  assert.equal(context.getCutoff()?.toISOString(), "2026-06-14T12:00:00.000Z");
});

test("hard-deletes an old row only after storage deletion succeeds", async () => {
  const context = createDependencies({
    purgeCandidates: [{ id: "old-2", storageKey: "images/old-2.png" }],
  });

  const stats = await executeImageCleanup(context.dependencies, NOW);

  assert.deepEqual(context.deletedStorageKeys, ["images/old-2.png"]);
  assert.deepEqual(context.hardDeletedImageIds, ["old-2"]);
  assert.equal(stats.purgeCandidates, 1);
  assert.equal(stats.hardDeleted, 1);
});

test("a transient storage failure remains retryable on the next pass", async () => {
  const failStorageKeys = new Set(["images/retry.png"]);
  const first = createDependencies({
    purgeCandidates: [{ id: "retry", storageKey: "images/retry.png" }],
    failStorageKeys,
  });

  await executeImageCleanup(first.dependencies, NOW);
  assert.deepEqual(first.hardDeletedImageIds, []);

  failStorageKeys.clear();
  const second = createDependencies({
    purgeCandidates: [{ id: "retry", storageKey: "images/retry.png" }],
    failStorageKeys,
  });
  const stats = await executeImageCleanup(second.dependencies, NOW);

  assert.deepEqual(second.hardDeletedImageIds, ["retry"]);
  assert.equal(stats.hardDeleted, 1);
});

test("keeps a cleaned row retryable when the database delete fails", async () => {
  const context = createDependencies({
    purgeCandidates: [{ id: "db-retry", storageKey: "images/db-retry.png" }],
    failHardDeleteIds: new Set(["db-retry"]),
  });

  const stats = await executeImageCleanup(context.dependencies, NOW);

  assert.deepEqual(context.deletedStorageKeys, ["images/db-retry.png"]);
  assert.deepEqual(context.hardDeletedImageIds, ["db-retry"]);
  assert.equal(stats.hardDeleted, 0);
  assert.equal(stats.storageDeleteFailures, 0);
  assert.equal(stats.databaseDeleteFailures, 1);
  assert.equal(context.warnings[0]?.message, "Failed to hard-delete cleaned image row");
});
