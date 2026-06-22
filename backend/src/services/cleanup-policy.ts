const HARD_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupImageRef {
  id: string;
  storageKey: string;
}

export interface CleanupDependencies {
  markExpired(now: Date): Promise<number>;
  findNewlyDeleted(now: Date): Promise<CleanupImageRef[]>;
  findDeletedBefore(cutoff: Date): Promise<CleanupImageRef[]>;
  deleteStoredImage(storageKey: string): Promise<void>;
  hardDeleteImage(imageId: string): Promise<boolean>;
  warn(message: string, metadata: Record<string, unknown>): void;
}

export interface CleanupStats {
  newlyExpired: number;
  immediateStorageDeletes: number;
  storageDeleteFailures: number;
  databaseDeleteFailures: number;
  purgeCandidates: number;
  hardDeleted: number;
}

/**
 * Runs one cleanup pass.
 *
 * Storage deletion is deliberately idempotent: the production implementation
 * treats ENOENT as success. Old database rows are removed only after storage
 * deletion succeeds, so a transient filesystem failure can never orphan a file
 * by deleting its final database reference.
 */
export async function executeImageCleanup(
  dependencies: CleanupDependencies,
  now: Date,
): Promise<CleanupStats> {
  const newlyExpired = await dependencies.markExpired(now);
  const stats: CleanupStats = {
    newlyExpired,
    immediateStorageDeletes: 0,
    storageDeleteFailures: 0,
    databaseDeleteFailures: 0,
    purgeCandidates: 0,
    hardDeleted: 0,
  };

  if (newlyExpired > 0) {
    const newlyDeleted = await dependencies.findNewlyDeleted(now);
    for (const image of newlyDeleted) {
      try {
        await dependencies.deleteStoredImage(image.storageKey);
        stats.immediateStorageDeletes += 1;
      } catch (err) {
        stats.storageDeleteFailures += 1;
        dependencies.warn("Failed to delete newly expired storage file", {
          imageId: image.id,
          storageKey: image.storageKey,
          error: String(err),
        });
      }
    }
  }

  const cutoff = new Date(now.getTime() - HARD_DELETE_GRACE_MS);
  const purgeCandidates = await dependencies.findDeletedBefore(cutoff);
  stats.purgeCandidates = purgeCandidates.length;

  for (const image of purgeCandidates) {
    try {
      // Retry storage deletion even if the first attempt happened seven days
      // ago. ENOENT is success, making this safe after an earlier successful
      // delete or when two server instances clean the same row concurrently.
      await dependencies.deleteStoredImage(image.storageKey);
    } catch (err) {
      stats.storageDeleteFailures += 1;
      dependencies.warn("Deferring image hard delete because storage cleanup failed", {
        imageId: image.id,
        storageKey: image.storageKey,
        error: String(err),
      });
      continue;
    }

    try {
      if (await dependencies.hardDeleteImage(image.id)) {
        stats.hardDeleted += 1;
      }
    } catch (err) {
      // The file is already gone, but deleteStoredImage treats ENOENT as
      // success, so the database row remains safe to retry next pass.
      stats.databaseDeleteFailures += 1;
      dependencies.warn("Failed to hard-delete cleaned image row", {
        imageId: image.id,
        storageKey: image.storageKey,
        error: String(err),
      });
    }
  }

  return stats;
}
