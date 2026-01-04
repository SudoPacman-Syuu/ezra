// Import core Node.js modules
const https = require('https'); // For making HTTPS requests
const fs = require('fs');       // File system module (not used in this script but imported)
const readline = require('readline'); // For updating progress on the console
const { URL } = require('url'); // To parse and resolve URLs

// Limit of concurrent HEAD requests to check JS URLs
const MAX_CONCURRENT = 30;

// --- Function: check if a JS URL exists using HEAD request ---
function checkJsUrl(url) {
  return new Promise((resolve) => {
    https
      .request(url, { method: 'HEAD' }, (res) => {
        // If response status is 200, the file exists
        resolve(res.statusCode === 200);
      })
      .on('error', () => resolve(false)) // On any error, consider file non-existent
      .end();
  });
}

// --- Function: fetch robots.txt content from a base URL ---
function fetchRobotsTxt(baseUrl) {
  return new Promise((resolve, reject) => {
    if (!baseUrl.endsWith('/')) baseUrl += '/'; // Ensure trailing slash
    const robotsUrl = new URL('/robots.txt', baseUrl).href; // Construct full robots.txt URL

    let data = '';
    https.get(robotsUrl, (res) => {
      res.on('data', chunk => { data += chunk.toString(); }); // Accumulate chunks
      res.on('end', () => resolve(data)); // Return full content
    }).on('error', reject); // Reject promise on error
  });
}

// --- Function: parse Disallow paths from robots.txt content ---
function parseDisallowPaths(content) {
  return content
    .split(/\r?\n/) // Split by newlines
    .map(l => l.trim()) // Trim whitespace
    .filter(l => l && !l.startsWith('#') && !l.toLowerCase().startsWith('sitemap:')) // Ignore comments & sitemaps
    .map(l => l.match(/^Disallow:\s*(.+)$/i)) // Match lines starting with "Disallow:"
    .filter(Boolean) // Keep only matches
    .map(m => m[1].trim()); // Extract path
}

// --- Function: expand likely JS file paths from Disallow entries ---
function expandPaths(paths) {
  const expanded = [];
  for (let p of paths) {
    if (!p || p.startsWith('?') || p.startsWith('http')) continue; // Skip invalid/absolute paths
    p = p.replace(/\*/g, ''); // Remove asterisks
    if (p.endsWith('.js')) {
      expanded.push(p); // Direct JS file
    } else if (p.endsWith('/')) {
      expanded.push(`${p}main.js`, `${p}index.js`); // Folder: add common filenames
    } else {
      expanded.push(`${p}/main.js`, `${p}/index.js`); // Path without trailing slash: assume folder
    }
  }
  return expanded;
}

// --- Function: check which JS URLs actually exist, concurrently ---
async function filterExistingJs(jsPaths, baseUrl) {
  const results = [];
  const queue = [];

  // Resolve paths relative to base URL
  for (let p of jsPaths) {
    try {
      const urlObj = new URL(p, baseUrl);
      urlObj.pathname = urlObj.pathname.replace(/\/{2,}/g, '/'); // Normalize double slashes
      if (urlObj.pathname.endsWith('.js/')) urlObj.pathname = urlObj.pathname.slice(0, -1); // Clean up trailing slash
      queue.push(urlObj.href);
    } catch {}
  }

  let processed = 0;
  const total = queue.length;

  // Create workers to process HEAD requests concurrently
  const workers = Array(MAX_CONCURRENT).fill().map(async () => {
    while (queue.length) {
      const url = queue.shift(); // Take next URL from queue
      if (!url) break;
      if (await checkJsUrl(url)) results.push(url); // Add if exists
      processed++;
      readline.cursorTo(process.stdout, 0); // Move cursor to start
      process.stdout.write(`Verified JS: ${processed}/${total}`); // Progress output
    }
  });

  await Promise.all(workers); // Wait for all workers to finish
  console.log('\n'); // Newline after progress
  return results; // Return verified JS URLs
}

// --- Main function: scrape JS from robots.txt disallow paths ---
async function robotsScrape(baseUrl) {
  console.log(`Fetching robots.txt from ${baseUrl}...`);
  const robotsTxt = await fetchRobotsTxt(baseUrl); // Get robots.txt
  const disallowed = parseDisallowPaths(robotsTxt); // Parse Disallow entries

  console.log(`Found ${disallowed.length} disallow entries, expanding likely JS paths...`);
  const expanded = expandPaths(disallowed); // Expand to probable JS file paths

  console.log(`Checking ${expanded.length} potential JS files for existence...`);
  const jsFiles = await filterExistingJs(expanded, baseUrl); // Verify existence

  console.log(`\nFound ${jsFiles.length} real .js files from robots.txt.`);

  return { baseUrl, jsFiles }; // Return results
}

// Export the main robotsScrape function
module.exports = robotsScrape;
