// Import Node.js core modules
const fs = require('fs');           // File system operations: create directories, write files, check existence
const path = require('path');       // Utilities for working with file and directory paths
const axios = require('axios');     // HTTP client for making GET requests to download scripts
const crypto = require('crypto');   // Cryptography module, used here to hash query strings for filenames

// --- Main function: download JavaScript files from an array of URLs ---
async function downloadscrapes(scriptUrls, siteUrl) {
  // Extract hostname from site URL (e.g., "example.com")
  const parsedDomain = new URL(siteUrl).hostname;

  // Base directory for this site's scrapes
  const siteDir = path.join(__dirname, '..', 'scrapelists', parsedDomain);

  // Directory specifically for downloaded JS files
  const jsDir = path.join(siteDir, 'downloaded-js');

  // Create JS directory if it doesn't exist (including parent directories)
  if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir, { recursive: true });

  // Loop through each URL in the provided array
  for (const url of scriptUrls) {
    try {
      const urlObj = new URL(url); // Parse URL for easier access to path and query

      // Build full file path based on the URL pathname
      let filePath = path.join(jsDir, urlObj.pathname);

      // If URL has query parameters, create a hash to append to the filename
      if (urlObj.search) {
        const hash = crypto.createHash('md5').update(urlObj.search).digest('hex'); // MD5 hash of query string
        const ext = path.extname(filePath) || '.js'; // Keep original extension or default to ".js"
        filePath = filePath.replace(/\?.*$/, '') + '-' + hash + ext; // Append hash to avoid collisions
      }

      // Ensure the folder for this file exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Skip download if file already exists
      if (fs.existsSync(filePath)) continue;

      // --- Download the JS file ---
      const response = await axios.get(url, {
        responseType: 'text', // Get file contents as string
        headers: {            // Mimic a standard browser User-Agent to avoid blocks
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                        'Chrome/117.0.0.0 Safari/537.36'
        },
        maxRedirects: 5       // Follow up to 5 redirects automatically
      });

      // Write the file contents to disk
      fs.writeFileSync(filePath, response.data);

      // Log the download, stripping the base JS directory from path for readability
      console.log('Downloaded:', filePath.replace(jsDir + '/', ''));

    } catch (err) {
      // Handle errors: either HTTP errors or other exceptions
      if (err.response) {
        console.error(`Failed to download: ${url} | HTTP ${err.response.status}`);
      } else {
        console.error(`Failed to download: ${url} | ${err.message}`);
      }
    }
  }

  // Log completion of the download process
  console.log(`Finished downloading ${scriptUrls.length} scripts to ${jsDir}`);
}

// Export the function so it can be imported and used elsewhere
module.exports = downloadscrapes;
