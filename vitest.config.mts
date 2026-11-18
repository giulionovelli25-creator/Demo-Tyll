import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"], env: { TYLL_DEMO_DATE: "2026-10-13" } },
});
