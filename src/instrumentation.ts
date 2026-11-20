// Runs once when the server starts. Builds the simulated dataset (sales, deliveries, counts) straight away, so the first
// visitor after a restart or a cold start does not wait for it on their first page.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VITEST) return;
  setTimeout(async () => {
    try {
      const { getDataset } = await import("./lib/data/generate");
      getDataset();
    } catch {
      // A warm-up that fails is only a slower first page; the page builds the data itself.
    }
  }, 0);
}
