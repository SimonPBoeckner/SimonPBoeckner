// generate-dramalist.js
// Fetches somethingcliche's completed dramas from the MDL API,
// downloads each poster, and writes dramalist.svg

const https = require("https");
const http = require("http");
const fs = require("fs");

const USERNAME = "somethingcliche";
const API_BASE = "https://my-drama-list-api-ten.vercel.app";

// SVG layout config
const COLS = 6;
const CARD_W = 100;
const CARD_H = 150;  // poster height (2:3 ratio)
const TITLE_H = 36; // space below poster for title + rating
const GAP = 12;
const PAD = 20;
const HEADER_H = 56;
const BG = "#0d1117";
const CARD_BG = "#161b22";
const TEXT_PRIMARY = "#e6edf3";
const TEXT_MUTED = "#8b949e";
const ACCENT = "#58a6ff";

// --- helpers ---

function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "dramalist-svg-bot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function getJson(url) {
  return get(url).then((r) => JSON.parse(r.body.toString()));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function toBase64(imgUrl) {
  if (!imgUrl) return null;
  try {
    const r = await get(imgUrl);
    if (r.status !== 200) return null;
    const mime = r.headers["content-type"]?.split(";")[0] || "image/jpeg";
    return `data:${mime};base64,${r.body.toString("base64")}`;
  } catch {
    return null;
  }
}

// Split a title into up to 2 lines that fit within maxChars per line
function splitTitle(title, maxChars = 14) {
  if (title.length <= maxChars) return [title];
  const words = title.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length <= maxChars) {
      line = (line + " " + word).trim();
    } else {
      if (line) lines.push(line);
      line = word.length > maxChars ? word.slice(0, maxChars - 1) + "…" : word;
      if (lines.length === 1) break; // max 2 lines
    }
  }
  if (line) lines.push(truncate(line, maxChars));
  return lines.slice(0, 2);
}

// --- main ---

async function main() {
  console.log("Fetching drama list…");
  const list = await getJson(`${API_BASE}/api/dramalist/${USERNAME}`);
  const completed = (list.dramas || []).filter((d) => d.status === "Completed");
  console.log(`Found ${completed.length} completed dramas`);

  // Fetch detail pages to get image URLs
  const dramas = [];
  for (let i = 0; i < completed.length; i++) {
    const d = completed[i];
    process.stdout.write(`  [${i + 1}/${completed.length}] ${d.title}… `);
    try {
      const detail = await getJson(`${API_BASE}/api/id/${d.slug}`);
      dramas.push({ ...d, imageUrl: detail.image || "" });
      process.stdout.write("ok\n");
    } catch (e) {
      dramas.push({ ...d, imageUrl: "" });
      process.stdout.write("failed (no image)\n");
    }
    await sleep(1200); // respect the 1s rate limit
  }

  // Download and base64-encode all poster images
  console.log("Downloading posters…");
  for (let i = 0; i < dramas.length; i++) {
    const d = dramas[i];
    process.stdout.write(`  [${i + 1}/${dramas.length}] poster… `);
    dramas[i].imgData = await toBase64(d.imageUrl);
    process.stdout.write(dramas[i].imgData ? "ok\n" : "placeholder\n");
  }

  // Build SVG
  const rows = Math.ceil(dramas.length / COLS);
  const svgW = COLS * CARD_W + (COLS - 1) * GAP + PAD * 2;
  const svgH = HEADER_H + rows * (CARD_H + TITLE_H) + (rows - 1) * GAP + PAD * 2;

  const defs = `
  <defs>
    <clipPath id="posterClip">
      <rect width="${CARD_W}" height="${CARD_H}" rx="6"/>
    </clipPath>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    </style>
  </defs>`;

  const header = `
  <text x="${PAD}" y="32" font-size="15" font-weight="600" fill="${TEXT_PRIMARY}">${escapeXml(USERNAME)}'s completed dramas</text>
  <text x="${PAD}" y="48" font-size="11" fill="${TEXT_MUTED}">${dramas.length} titles</text>`;

  const cards = dramas.map((d, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + GAP);
    const y = HEADER_H + PAD + row * (CARD_H + TITLE_H + GAP);

    const posterContent = d.imgData
      ? `<image href="${d.imgData}" width="${CARD_W}" height="${CARD_H}" clip-path="url(#posterClip)" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="${CARD_W}" height="${CARD_H}" rx="6" fill="${CARD_BG}"/>
         <text x="${CARD_W / 2}" y="${CARD_H / 2 + 4}" text-anchor="middle" font-size="20" fill="${TEXT_MUTED}">🎬</text>`;

    const lines = splitTitle(d.title);
    const titleY1 = CARD_H + 13;
    const titleY2 = CARD_H + 25;
    const titleLines = lines.map((line, li) =>
      `<text x="${CARD_W / 2}" y="${li === 0 ? titleY1 : titleY2}" text-anchor="middle" font-size="9" fill="${TEXT_PRIMARY}">${escapeXml(line)}</text>`
    ).join("\n");

    const ratingLine = d.rating
      ? `<text x="${CARD_W / 2}" y="${lines.length > 1 ? titleY2 + 11 : titleY2}" text-anchor="middle" font-size="9" fill="${ACCENT}">★ ${d.rating}</text>`
      : "";

    return `
  <a href="${escapeXml(d.url)}">
    <g transform="translate(${x},${y})">
      ${posterContent}
      ${titleLines}
      ${ratingLine}
    </g>
  </a>`;
  }).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <rect width="${svgW}" height="${svgH}" fill="${BG}" rx="10"/>
  ${defs}
  ${header}
  ${cards}
</svg>`;

  fs.writeFileSync("dramalist.svg", svg, "utf8");
  console.log(`\nWrote dramalist.svg (${svgW}×${svgH}px)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});