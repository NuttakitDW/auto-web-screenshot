// huelShot.js  – Playwright crawler with resume & retry
import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { XMLParser } from "fast-xml-parser";

/* ---------- tweakables ---------- */
const ROOT = process.env.ROOT_URL || "https://huel.com";
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = `screens/${TODAY}`;
const DONE_FILE = "done.txt";          // one URL per line
const DEPTH_MAX = 5;
const PAGES_MAX = 2000;
const CONCURRENCY = 3;
const DELAY_MS = 500;
const NAV_TIMEOUT = 90_000;              // 90 s
const RETRY_LIMIT = 1;                   // total tries = 1 + RETRY_LIMIT
/* --------------------------------- */

/* 1. Try XML sitemaps first */
async function grabSitemap() {
    try {
        const res = await fetch(`${ROOT}/sitemap.xml`, { timeout: 10_000 });
        const xml = await res.text();
        const x = new XMLParser().parse(xml);

        // shopify often -> <sitemapindex><sitemap><loc>
        const smaps = x.sitemapindex?.sitemap ?? [];
        let urls = x.urlset?.url ?? [];

        if (smaps.length) {
            for (const s of smaps) {
                const txt = await fetch(s.loc).then(r => r.text());
                const more = new XMLParser().parse(txt).urlset.url;
                urls = urls.concat(more);
            }
        }
        return urls.map(u => u.loc).filter(u => u.startsWith(ROOT));
    } catch { return null; }
}

/* 2. Fallback light crawler (HTML regex) */
function canon(u) {
    const x = new URL(u.split("#")[0]);
    x.searchParams.forEach((_, k) => k.startsWith("utm_") && x.searchParams.delete(k));
    return x.href;
}
async function crawlFallback() {
    const todo = [{ href: ROOT, depth: 0 }];
    const seen = new Set();
    const list = [];

    while (todo.length && list.length < PAGES_MAX) {
        const { href, depth } = todo.shift();
        const c = canon(href);
        if (seen.has(c) || depth > DEPTH_MAX) continue;
        seen.add(c); list.push(c);

        const html = await fetch(c).then(r => r.text());
        const raw = Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1]);
        for (const h of raw) {
            const abs = h.startsWith("http") ? h : ROOT + h;
            if (abs.startsWith(ROOT)) todo.push({ href: abs, depth: depth + 1 });
        }
    }
    return list;
}

/* 3. Load done-list & helper */
async function loadDone() {
    try { return (await fs.readFile(DONE_FILE, "utf-8")).split("\n").filter(Boolean); }
    catch { return []; }
}
async function markDone(url) {
    await fs.appendFile(DONE_FILE, url + "\n");
}

/* 4. Main */
(async () => {
    const urls = (await grabSitemap()) ?? await crawlFallback();
    await fs.mkdir(OUT, { recursive: true });

    const donePng = new Set(await fs.readdir(OUT).catch(() => []));

    const doneTxt = new Set(await loadDone());
    const done = new Set([...donePng].map(f => f.replace(/\.png$/, "")).concat([...doneTxt]));

    console.log(`Collected ${urls.length} URLs; already done ${done.size}. Starting screenshots…`);

    const browser = await chromium.launch();
    const pages = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => browser.newPage({ viewport: { width: 1280, height: 800 } }))
    );

    let idx = 0;

    for (const url of urls) {
        const safe = url.replace(/[^\w]/g, "_").slice(0, 120);
        if (done.has(safe)) continue;              // already have PNG or listed in done.txt

        const page = pages[idx % CONCURRENCY];
        idx += 1;

        let attempt = 0, success = false;
        while (attempt <= RETRY_LIMIT && !success) {
            try {
                await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
                await page.screenshot({ path: path.join(OUT, `${safe}.png`), fullPage: true });
                console.log("✔", url);
                await markDone(safe);
                success = true;
            } catch (err) {
                if (attempt === RETRY_LIMIT) {
                    console.error("✖", url, err.message);
                } else {
                    console.warn(`⟳ retrying (${attempt + 1}/${RETRY_LIMIT}) →`, url);
                }
            } finally {
                attempt += 1;
            }
        }
        await page.waitForTimeout(DELAY_MS);
    }

    await Promise.all(pages.map(p => p.close()));
    await browser.close();
    console.log("DONE – screenshots in", OUT);
})();
