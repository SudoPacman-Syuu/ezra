// functions/dynamicscraper.js

// Core Node.js modules
const fs = require('fs'); // File system module for reading/writing files
const path = require('path'); // Path module for handling filesystem paths
const { URL } = require('url'); // URL module to safely parse and manipulate URLs

// Third-party modules
const puppeteer = require('puppeteer'); // Headless browser automation for dynamic page scraping

// Import the central allowlist of file extensions we care about
const allowedExtensions = require('./config/allowedextensions'); // ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.json', '.wasm']

// --- Helper function: get the directory to store downloaded JS for a site ---
function getJsDir(siteUrl) {
  const hostname = new URL(siteUrl).hostname; // Extract hostname from site URL (e.g., www.example.com)
  return path.join(__dirname, '..', 'scrapelists', hostname, 'downloaded-js'); 
  // Path becomes something like: ../scrapelists/www.example.com/downloaded-js
}

// --- Helper function: ensure a directory exists, creating it if needed ---
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); 
  // `recursive: true` allows creating nested directories
}

// --- Main function: scrape dynamic JS from a page ---
async function dynamicScraper(siteUrl) {
  console.log(`\n[Dynamic Scraper] Starting dynamic JS collection for: ${siteUrl}`);

  const jsDir = path.join(getJsDir(siteUrl), 'dynamic'); // Determine where downloaded files will go
  ensureDirExists(jsDir); // Make sure the directory exists before saving files

  // --- Launch a headless Chromium instance using Puppeteer ---
  const browser = await puppeteer.launch({ headless: true }); // headless browser (no UI)
  const page = await browser.newPage(); // Open a new tab/page

  const seenUrls = new Set(); // Track URLs we've already collected to avoid duplicates
  let totalRequests = 0; // Counter for all network requests intercepted

  // --- Intercept network requests on the page ---
  await page.setRequestInterception(true); // Allows us to observe/modify each request
  page.on('request', request => {
    const url = request.url(); // Full URL of the request
    const ext = path.extname(url).split('?')[0]; // Extract file extension, ignore query string

    totalRequests++; // Increment request counter

    // Debug output: show each network request as it happens
    console.log(`[Request #${totalRequests}] ${url}`);

    // Only save URLs that match our allowed file extensions
    if (allowedExtensions.includes(ext)) {
      seenUrls.add(url); // Add to set for later downloading
      request.continue(); // Let the request continue normally
    } else {
      request.continue(); // Request proceeds, but we won’t save it
    }
  });

  // --- Navigate to the page and wait for network activity to settle ---
  console.log('[Dynamic Scraper] Loading page...');
  await page.goto(siteUrl, { waitUntil: 'networkidle2' }); 
  // `networkidle2` waits until there are no more than 2 network connections for at least 500ms
  console.log('[Dynamic Scraper] Page loaded. Intercepted network requests complete.');

  // --- Download each unique URL we intercepted ---
  let downloaded = 0; // Counter for how many files are actually saved
  for (const url of seenUrls) {
    try {
      const urlObj = new URL(url); // Safely parse URL
      let filePath = path.join(jsDir, urlObj.pathname); // Build local file path

      // --- Handle query strings in filenames ---
      if (urlObj.search) {
        const hash = require('crypto')
          .createHash('md5')
          .update(urlObj.search)
          .digest('hex'); // Hash query string to avoid filename collisions
        const ext = path.extname(filePath) || '.js'; // Default to .js if extension missing
        filePath = filePath.replace(/\?.*$/, '') + '-' + hash + ext; 
        // Result: main.js?version=123 -> main-<hash>.js
      }

      ensureDirExists(path.dirname(filePath)); // Ensure the parent directory exists

      // --- Skip already downloaded files ---
      if (fs.existsSync(filePath)) {
        console.log(`[Skip] Already downloaded: ${url}`);
        continue;
      }

      // --- Fetch content using Puppeteer page.goto (reuses browser context/cookies) ---
      const response = await page.goto(url); // Navigate to URL to get content
      const buffer = await response.buffer(); // Read response as raw bytes (handles JS, WASM, JSON)

      fs.writeFileSync(filePath, buffer); // Save file to disk
      downloaded++;
      console.log(`[Saved #${downloaded}] ${filePath.replace(jsDir + '/', '')}`); 
      // Print relative path for clarity
    } catch (err) {
      console.error(`[Error] Failed to download ${url}: ${err.message}`);
      // Catch network errors, parse errors, etc.
    }
  }

  console.log(`[Dynamic Scraper] Finished. Downloaded ${downloaded} dynamic files to ${jsDir}`);

  await browser.close(); // Clean up browser instance
}

// Export the function so it can be used in index.js
module.exports = dynamicScraper;
