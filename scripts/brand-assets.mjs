// Derives the logo and background files used in the app from the two supplied Tyll images
// (public/brand/tyll-banner.webp and tyll-icon.webp). Run with: node scripts/brand-assets.mjs
// The shapes are not redrawn: each pixel's darkness becomes its opacity, so the mark and
// wordmark keep the exact proportions of the original artwork.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const brand = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const banner = path.join(brand, "tyll-banner.webp");
const INK = [20, 22, 26];
const BG_LUMA = 228; // banner background around the logo
const INK_LUMA = 48;
const LOCKUP = { left: 1078, top: 192, width: 700, height: 240 };

async function toTransparent(out, crop) {
  const { data, info } = await sharp(banner).extract(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const alpha = Math.max(0, Math.min(1, (BG_LUMA - luma) / (BG_LUMA - INK_LUMA)));
    rgba[j] = INK[0];
    rgba[j + 1] = INK[1];
    rgba[j + 2] = INK[2];
    rgba[j + 3] = Math.round(alpha * 255);
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toFile(path.join(brand, out));
}

await toTransparent("tyll-lockup-ink.png", LOCKUP);
await toTransparent("tyll-mark-ink.png", { ...LOCKUP, width: 240 });
// The flowing layers to the left of the logo, used behind headers and empty states.
await sharp(banner).extract({ left: 0, top: 0, width: 1040, height: 667 }).webp({ quality: 86 }).toFile(path.join(brand, "tyll-waves.webp"));
console.log("brand assets written");
