const fs = await import('fs').then(m=>m.default);
const { setTimeout: wait } = await import('timers/promises');

const ARGS = process.argv.slice(2);
if (ARGS.length === 0) {
  console.error('Usage: node find_reg_ranges_auto.js <maxId>  OR  node find_reg_ranges_auto.js <startId> <maxId>');
  process.exit(1);
}
const START_ID = Number(ARGS.length === 1 ? 1 : Number(ARGS[0]));
const MAX_ID = Number(ARGS.length === 1 ? Number(ARGS[0]) : Number(ARGS[1]));

if (!Number.isInteger(START_ID) || !Number.isInteger(MAX_ID) || START_ID <= 0 || START_ID > MAX_ID) {
  console.error('Invalid start/max IDs');
  process.exit(1);
}

/* ---------- Configuration ---------- */
// This code was also used for threads and posts. All that’s needed is to adjust the values.
const BASE = 'https://www.fxp.co.il/member.php?u=';
const DATE_REGEX = /<dl\s+class=["']stats["'][^>]*>[\s\S]*?<dt>\s*תאריך הצטרפות\s*<\/dt>\s*<dd>\s*([\d]{1,2}[-\/][\d]{1,2}[-\/]\d{2,4})\s*<\/dd>[\s\S]*?<\/dl>/iu;
const CACHE_FILE = 'cache.json';
const CSV_FILE = 'reg_ranges.csv';
const SAVE_EVERY_MS = 30_000; // שמור כל 30 שניות
const DELAY_MS_AFTER_FETCH = 50; // השהיה אחרי כל fetch (גם כש יש concurrency)
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 6; // כמות העובדים. הגדל להאצה (עם סיכון לחסימה)
const RETRIES = 3; // כמה ניסיונות חוזרים על fetch
const SPLIT_THRESHOLD = 8; // אם טווח <= זה, נבדוק פריטים בודדים במקום להמשיך לפצל
/* ----------------------------------- */

let cache = {};
try {
    if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        cache = JSON.parse(raw);
    } else {
        cache = {};
    }
} catch (e) {
    console.warn('Failed to load cache.json, starting fresh:', e.message);
    cache = {};
}

function saveCacheSync() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
    console.log('cache saved');
  } catch (e) {
    console.warn('Failed to save cache:', e.message);
  }
}

function writeCsvRanges(ranges) {
  const lines = ['start,end,monthKey'];
  for (const r of ranges) {
    lines.push(`${r.start},${r.end},${r.monthKey ?? ''}`);
  }
  fs.writeFileSync(CSV_FILE, lines.join('\n'), 'utf8');
}

// fetch with timeout and retries
function fetchWithTimeout(url, timeout = FETCH_TIMEOUT_MS, signal = undefined) {
  const controller = new AbortController();
  const combinedSignal = signal ?? controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: combinedSignal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; reg-range-bot/1.0)' } })
    .finally(() => clearTimeout(timer));
}

async function fetchHtmlWithRetries(url, retries = RETRIES) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text;
    } catch (err) {
      lastErr = err;
      const backoff = 500 + i * 500;
      await wait(backoff);
    }
  }
  throw lastErr;
}

function normalizeDateStr(dateStr) {
  const m = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (!m) return null;
  let [ , d, mth, y ] = m;
  if (y.length === 2) y = '20' + y;
  d = d.padStart(2, '0');
  mth = mth.padStart(2, '0');
  return `${y}-${mth}-${d}`; // YYYY-MM-DD
}
function monthKeyFromFullDate(fullDate) {
  if (!fullDate) return null;
  return fullDate.slice(0,7); // YYYY-MM
}

async function getMonthKeyForId(id) {
  // cache key is string of id
  const sid = String(id);
  if (cache[sid] && cache[sid].monthKey !== undefined) return cache[sid].monthKey;
  const url = BASE + id;
  try {
    const html = await fetchHtmlWithRetries(url);
    const m = html.match(DATE_REGEX);
    if (m && m[1]) {
      const normalized = normalizeDateStr(m[1].trim());
      const monthKey = monthKeyFromFullDate(normalized);
      cache[sid] = { monthKey, fullDate: normalized, error: null, fetchedAt: Date.now() };
      await wait(DELAY_MS_AFTER_FETCH);
      return monthKey;
    } else {
      cache[sid] = { monthKey: null, fullDate: null, error: 'no-date-found', fetchedAt: Date.now() };
      await wait(DELAY_MS_AFTER_FETCH);
      return null;
    }
  } catch (err) {
    cache[sid] = { monthKey: null, fullDate: null, error: err.message || 'fetch-error', fetchedAt: Date.now() };
    await wait(DELAY_MS_AFTER_FETCH);
    return null;
  }
}

// divide-and-conquer with queue + workers
const rangesQueue = [];
// initialize queue with whole range from START_ID..MAX_ID
rangesQueue.push({ start: START_ID, end: MAX_ID });

const results = []; // collects {start,end,monthKey}

let processedRanges = 0;
let lastSave = Date.now();

async function processRange(range) {
  const { start, end } = range;
  // quick guard
  if (start > end) return;

  const keyA = await getMonthKeyForId(start);
  const keyB = await getMonthKeyForId(end);

  if (keyA && keyB && keyA === keyB) {
    results.push({ start, end, monthKey: keyA });
    processedRanges++;
    return;
  }

  const len = end - start + 1;
  if (len <= SPLIT_THRESHOLD) {
    // fetch individually
    for (let id = start; id <= end; id++) {
      const k = await getMonthKeyForId(id);
      results.push({ start: id, end: id, monthKey: k });
    }
    processedRanges++;
    return;
  }

  // otherwise split to halves
  const mid = Math.floor((start + end) / 2);
  // Push right then left (LIFO-ish) so we explore left sooner — doesn't matter much.
  rangesQueue.push({ start: mid+1, end });
  rangesQueue.push({ start, end: mid });
};

async function worker(workerId) {
  while (true) {
    let range;
    // pop a range from queue (safely)
    // simple synchronization: queue is an array; we pop the last element
    range = rangesQueue.pop();
    if (!range) break; // queue empty -> worker done

    try {
      await processRange(range);
    } catch (e) {
      console.error(`Worker ${workerId} error processing ${range.start}-${range.end}:`, e.message || e);
      // on error, requeue after small delay
      rangesQueue.push(range);
      await wait(2000);
    }

    // periodic save
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      lastSave = Date.now();
      saveCacheSync();
      try {
        // merge & write CSV current state for convenience
        const merged = mergeRanges(results);
        writeCsvRanges(merged);
        console.log(`Auto-saved cache & ${CSV_FILE}. ProcessedRanges: ${processedRanges}, Queue size: ${rangesQueue.length}`);
      } catch (e) {
        console.warn('Failed to write CSV during autosave:', e.message);
      }
    }
  }
}

function mergeRanges(rawRanges) {
  // rawRanges may have overlapping individual entries; sort by start and merge adjacent with same monthKey
  const arr = rawRanges.slice().sort((a,b)=>a.start - b.start);
  const merged = [];
  for (const r of arr) {
    if (!merged.length) { merged.push({...r}); continue; }
    const last = merged[merged.length-1];
    if (last.monthKey === r.monthKey && last.end + 1 >= r.start) {
      // merge and extend end to max
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({...r});
    }
  }
  return merged;
}

(async () => {
  console.log(`Starting analyze ${START_ID}..${MAX_ID}  (concurrency=${CONCURRENCY}, split-threshold=${SPLIT_THRESHOLD})`);
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker(i+1));
  await Promise.all(workers);

  // finished: merge and write CSV & cache
  saveCacheSync();
  const merged = mergeRanges(results);
  writeCsvRanges(merged);
  console.log('Done. Final ranges written to', CSV_FILE);
  console.log(`ProcessedRanges: ${processedRanges}, final merged ranges: ${merged.length}`);
})();
