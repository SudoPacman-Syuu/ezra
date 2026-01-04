// Import Node.js core modules
const fs = require('fs');       // Provides functions for file system operations (read/write files, check directories)
const path = require('path');   // Utilities to handle and normalize file paths
const { URL } = require('url'); // Utility to parse and resolve URLs

// --- Main function: save an array of script URLs for a website ---
function savescrapesjson(scriptUrls, siteUrl) {
    // Parse the provided site URL to extract the hostname (e.g., "example.com")
    const parsedUrl = new URL(siteUrl);
    const domain = parsedUrl.hostname;

    // Construct the directory path to store scripts for this specific site
    const siteDir = path.join(__dirname, '..', 'scrapelists', domain);

    // If the directory does not exist, create it recursively (including parent folders)
    if (!fs.existsSync(siteDir)) {
        fs.mkdirSync(siteDir, { recursive: true });
    }

    // Convert all script URLs to absolute URLs using the site as the base
    const resolvedScripts = scriptUrls
        .map(src => {
            try {
                return new URL(src, siteUrl).href; // Resolve relative URLs to absolute
            } catch {
                return null; // Skip invalid URLs
            }
        })
        .filter(Boolean); // Remove any null values from failed URL parsing

    // Construct the full path for the JSON file to save the scripts
    const filename = path.join(siteDir, 'scripts.json');

    // Write the array of resolved scripts to a JSON file with pretty formatting
    fs.writeFileSync(filename, JSON.stringify(resolvedScripts, null, 2));

    // Log output to confirm how many scripts were saved and the location of the file
    console.log(`Saved ${resolvedScripts.length} scripts to ${filename}`);
}

// Export the function so it can be imported and used in other scripts
module.exports = savescrapesjson;
