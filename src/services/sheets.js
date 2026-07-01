'use strict';

const fetch = require('node-fetch');

/**
 * Fetch a Google Sheet (or any CSV URL) as text so it can be fed to the AI
 * as reference data. The sheet must be shared as "Anyone with the link can
 * view" — we use the public CSV export endpoint, no API key needed.
 */

/** Convert a normal Google Sheets URL into its CSV export URL. */
function toCsvUrl(url) {
  const m = String(url || '').match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (m) {
    const gid = (String(url).match(/[#&?]gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? '&gid=' + gid : ''}`;
  }
  return url; // assume it's already a direct CSV/text link
}

/**
 * Download the sheet as CSV text (size-capped).
 * @returns {Promise<string>}
 */
async function fetchCsv(url, { maxChars = 20000 } = {}) {
  const csvUrl = toCsvUrl(url);
  const res = await fetch(csvUrl, { timeout: 15000, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(
      `Không tải được Google Sheet (HTTP ${res.status}). ` +
        `Hãy chắc chắn sheet được chia sẻ "Bất kỳ ai có liên kết đều xem được".`
    );
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) {
    throw new Error('Link trả về trang HTML thay vì dữ liệu — sheet chưa được chia sẻ công khai.');
  }
  return text.length > maxChars ? text.slice(0, maxChars) + '\n...(cắt bớt)' : text;
}

module.exports = { toCsvUrl, fetchCsv };
