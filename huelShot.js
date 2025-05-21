// huelShot.js
import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { XMLParser } from "fast-xml-parser";

const ROOT = "https://huel.com";
const OUT = `screens/${new Date().toISOString().slice(0, 10)}`;
const DEPTH_MAX = 5;
const PAGES_MAX = 2000;
const DELAY_MS = 500;
const CONCURRENCY = 3;               // browser tabs

/* ---------- helper: try sitemap first ---------- */
async function grabSitemap() {
    try {
        const res = await fetch(`${ROOT}/sitemap.xml`, { timeout: 10_000 });
        const xml = await res.text();
        const parser = new XMLParser();
        const obj = parser.parse(xml);
        // Shopify sites often use a <sitemapindex>; fall back to <urlset>
        const childMaps = obj.sitemapindex?.sitemap ?? [];
        const urls = obj.urlset?.url ?? [];
        let list = [];

        if (childMaps.length) {
            for (const m of childMaps) {
                const r = await fetch(m.loc);
                const txt = await r.text();
                list = list.concat(parser.parse(txt).urlset.url);
            }
        } else list = urls;

        return list.map(u => u.loc).filter(u => u.startsWith(ROOT));
    } catch {               // any error → return null so we crawl
        return null;
    }
}

/* ---------- fallback crawler ---------- */
function normalise(u) {
    const url = new URL(u.split("#")[0]);
    url.searchParams.forEach((_, k) => {         // strip UTM etc.
        if (k.startsWith("utm_")) url.searchParams.delete(k);
    });
    return url.href;
}

async function crawlFallback() {
    const q = [{ href: ROOT, depth: 0 }];
    const seen = new Set();
    const list = [];

    while (q.length && list.length < PAGES_MAX) {
        const { href, depth } = q.shift();
        const canon = normalise(href);
        if (seen.has(canon) || depth > DEPTH_MAX) continue;
        seen.add(canon);
        list.push(canon);

        // light HTML fetch just to extract links
        const res = await fetch(canon);
        const html = await res.text();
        const matches = Array.from(html.matchAll(/href="([^"]+)"/g))
            .map(m => m[1])
            .filter(h => h.startsWith("/") || h.startsWith(ROOT));

        for (const m of matches) {
            const abs = m.startsWith("http") ? m : ROOT + m;
            if (abs.startsWith(ROOT)) q.push({ href: abs, depth: depth + 1 });
        }
    }
    return list;
}

/* ---------- main runner ---------- */
const urls = (await grabSitemap()) ?? await crawlFallback();
console.log(`Collected ${urls.length} URLs – starting screenshots…`);

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const pool = Array.from({ length: CONCURRENCY },
    () => browser.newPage({ viewport: { width: 1280, height: 800 } })
);

let i = 0;
for (const url of urls) {
    const page = pool[i % CONCURRENCY];
    i += 1;

    await page.goto(url, { waitUntil: "networkidle" });
    const safe = url.replace(/[^\w]/g, "_").slice(0, 120);
    await page.screenshot({ path: path.join(OUT, `${safe}.png`), fullPage: true });
    console.log("✔", url);

    await page.waitForTimeout(DELAY_MS);
}

await Promise.all(pool.map(p => p.close()));
await browser.close();
console.log(`Done – screenshots saved to ${OUT}`);
