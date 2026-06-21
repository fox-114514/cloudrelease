import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test-unit/**/*.node.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
