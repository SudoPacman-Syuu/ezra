#!/usr/bin/env node
// This shebang allows the script to be run directly from the command line on Unix systems

// --- Primary imports ---
const axios = require('axios');               // HTTP client for fetching web pages and JS files
const cheerio = require('cheerio');           // jQuery-like HTML parser for Node.js
const { URL } = require('url');               // Node.js URL parser
const path = require('path'); // required for run the goods
const fs = require('fs');
const savescrapes = require('./functions/savescrapes');       // Function to save scraped JS URLs to a JSON file
const downloadscrapes = require('./functions/downloadscrapes'); // Function to download JS files to disk
const robotsScrape = require('./functions/robots');           // Function to parse robots.txt for JS files
const extractrequests = require('./functions/extractrequests'); // Function to extract endpoints from JS files
const allowedextensions = require('./functions/config/allowedextensions'); // Regex for what file types are extracted and downloaded by scraper
const dynamicScraper = require('./functions/dynamicscraper'); // Handles dynamic JS collection
const runthegoods = require('./functions/runthegoods'); // runs the MF goods on them bitches
const extractSignal = require('./functions/extractsignal'); // refines the goods
const args = process.argv.slice(2);


if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    console.log(`
Usage: ezra https://

Output will go to the ezra folder /scanlists/

`);
    process.exit(0);
}


// --- Main async function ---
async function main() {
    // Get the target URL from the command-line arguments
    const url = process.argv[2];

    // Exit if no URL was provided
    if (!url) {
        console.log("Provide a URL in format: 'https://example.com or https://www.example.com'");
        process.exit(1);
    }

    // --- Step 1: fetch HTML of the page ---
    const { data: html } = await axios.get(url); // Perform HTTP GET request
    const $ = cheerio.load(html);               // Load HTML into Cheerio for parsing
    isDocument = false;                          // (Possibly a leftover/debug flag—does nothing meaningful here)

    // --- Step 2: determine base URL ---
    let baseUrl = url;                           // Default base URL if no <base> tag is found
    const baseTag = $('base[href]').attr('href'); // Check for <base href="..."> tag
    if (baseTag) {
        try {
            baseUrl = new URL(baseTag, url).href; // Resolve relative base URL to absolute
        } catch {}
    }

    // --- Step 3: collect all static script URLs from HTML ---
    const scriptUrls = [];

    // Collect <script src="...">
    $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src) scriptUrls.push(src);
    });

    // Collect <link rel="preload" as="script" href="...">
    $('link[rel="preload"][as="script"][href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) scriptUrls.push(href);
    });

    // --- Step 4: resolve all URLs to absolute URLs ---
    const resolvedScripts = scriptUrls
        .map(src => {
            try {
                return new URL(src, baseUrl).href; // Convert relative URLs to absolute
            } catch {
                return null;
            }
        })
        .filter(Boolean); // Remove nulls from failed URL parsing

    // --- Step 5: fetch JS paths from robots.txt disallows ---
    const robotsOutput = await robotsScrape(baseUrl); // Returns { baseUrl, jsFiles }

    // --- Step 6: Filter and combine scripts by allowed file types ---

    // 6.1 Filter scripts found in HTML
    // For every URL collected from <script> and <link> tags, we check if it ends
    // with one of the allowed extensions (e.g., .js, .mjs, .ts, .jsx, .tsx, .json, .wasm)
    // Only URLs that match our allowlist are kept.
    const filteredHtmlScripts = resolvedScripts.filter(url =>
        allowedextensions.some(ext => url.endsWith(ext))
    );

    // 6.2 Filter scripts inferred from robots.txt
    // Same logic as above, but applied to the list of JS URLs inferred from
    // disallow paths in robots.txt. This ensures we only download allowed file types.
    const filteredRobotsScripts = robotsOutput.jsFiles.filter(url =>
        allowedextensions.some(ext => url.endsWith(ext))
    );

    // 6.3 Combine both filtered lists and remove duplicates
    // Use a Set to automatically deduplicate entries that might appear in both
    // the HTML-collected list and the robots-collected list.
    // The resulting array is a definitive list of files that we will process.
    const allScripts = [...new Set([
        ...filteredHtmlScripts,
        ...filteredRobotsScripts
    ])];

    // --- Step 7: Save the comprehensive list of scripts ---
    // Pass the cleaned, deduplicated list to the save function.
    // This writes scripts.json to scrapelists/{hostname}/
    // so we have a persistent record of all allowed files found.
    savescrapes(allScripts, url);
    console.log(`Saved ${allScripts.length} total scripts for ${url}`);

    // --- Step 8: Download all allowed scripts to disk ---
    // This function downloads every URL in allScripts to scrapelists/{hostname}/downloaded-js/
    // It preserves folder structure based on URL paths and hashes query parameters
    // to avoid overwriting files. This ensures only files in our allowlist are saved.
    await downloadscrapes(allScripts, url);

    // --- Step 9: Scrape dynamic files via Puppeteer ---
    await dynamicScraper(url);  // This will launch a headless browser, capture dynamic JS/JSON/WASM/etc.
    
    // --- Step 10: Extract client-modifiable endpoints from downloaded JS ---
    // Analyze the downloaded JavaScript files to detect axios/fetch calls
    // and any client-modifiable request parameters.
    // The output is saved to analysis/js_request_surface.json
    // which is useful for security research or penetration testing.
    const findings = extractrequests(url);
    console.log(`Extracted ${findings.length} total request findings`);



    const hostname = new URL(url).hostname;
    // Input: downloaded JS root folder
    const scrapeOutputDir = path.join(__dirname, 'scrapelists', hostname, 'downloaded-js');
    // Output folder: analysis (same pattern as extractrequests.js)
    const analysisDir = path.join(__dirname, 'scrapelists', hostname, 'analysis');
    if (!fs.existsSync(analysisDir)) fs.mkdirSync(analysisDir, { recursive: true });
    // Output files
    const humanFile = path.join(analysisDir, 'goods_human.json');
    const machineFile = path.join(analysisDir, 'goods_machine.json');
    // Run your regex analyzer (runthegoods) on the downloaded JS folder


    await runthegoods(scrapeOutputDir, url);
    console.log(`The goods have been logged to: ${analysisDir}`);

    const signalsFile = extractSignal(machineFile);
    console.log(`These might be worth a look: ${signalsFile}`);




}

// Run the main function
main();
