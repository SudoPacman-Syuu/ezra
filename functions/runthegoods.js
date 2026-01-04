// functions/runthegoods.js

const fs = require('fs');
const path = require('path');

/*
|--------------------------------------------------------------------------
| Helper: Recursively walk a directory and return ALL .js files
|--------------------------------------------------------------------------
| Why this exists:
| - Downloaded JS is nested (Next.js, webpack chunks, dynamic folders, etc)
| - We cannot assume a flat directory
| - This guarantees we scan everything that was actually written to disk
*/
function getAllJsFiles(dir) {
  let results = [];

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // recurse into subdirectories
      results = results.concat(getAllJsFiles(fullPath));
    } else if (entry.endsWith('.js')) {
      results.push(fullPath);
    }
  }

  return results;
}

/*
|--------------------------------------------------------------------------
| Helper: Load all regex modules from /functions/regex/
|--------------------------------------------------------------------------
| Contract:
| - Each file must `module.exports = /regex/g`
| - Regex MUST be global (/g) or exec() will infinite-loop
|
| Output format:
| [
|   { name: 'secrets.js', regex: /.../g },
|   { name: 'flags.js',   regex: /.../g }
| ]
*/
function loadRegexes(regexDir) {
  const regexFiles = fs.readdirSync(regexDir).filter(f => f.endsWith('.js'));
  const loaded = [];

  for (const file of regexFiles) {
    const fullPath = path.join(regexDir, file);

    try {
      const re = require(fullPath);

      if (!(re instanceof RegExp)) {
        throw new Error('Module does not export a RegExp');
      }

      if (!re.flags.includes('g')) {
        throw new Error('Regex must use /g flag');
      }

      loaded.push({
        name: file,
        regex: re
      });
    } catch (err) {
      console.error(`[runthegoods] Failed loading ${file}: ${err.message}`);
    }
  }

  return loaded;
}

/*
|--------------------------------------------------------------------------
| Core Function
|--------------------------------------------------------------------------
| Input:
| - downloadedRootDir: absolute path to downloaded-js/
| - siteUrl: original target URL (used ONLY for hostname resolution)
|
| Behavior:
| - Scans all JS files
| - Applies all regexes
| - Extracts minimal ±50 char context
| - Writes:
|   - analysis/goods_machine.json
|   - analysis/goods_human.txt
*/
async function runthegoods(downloadedRootDir, siteUrl) {
  const hostname = new URL(siteUrl).hostname;

  const analysisDir = path.join(
    __dirname,
    '..',
    'scrapelists',
    hostname,
    'analysis'
  );

  if (!fs.existsSync(analysisDir)) {
    fs.mkdirSync(analysisDir, { recursive: true });
  }

  const regexDir = path.join(__dirname, 'regex');
  const regexes = loadRegexes(regexDir);

  const jsFiles = getAllJsFiles(downloadedRootDir);

  /*
  |--------------------------------------------------------------------------
  | Output containers
  |--------------------------------------------------------------------------
  | machineResults:
  |   structured, stable, diffable
  |
  | humanLines:
  |   readable without jq or tooling
  */
  const machineResults = [];
  const humanLines = [];

  /*
  |--------------------------------------------------------------------------
  | Main scan loop
  |--------------------------------------------------------------------------
  */
  for (const filePath of jsFiles) {
    const content = fs.readFileSync(filePath, 'utf8');

    for (const { name, regex } of regexes) {
      regex.lastIndex = 0; // CRITICAL: reset per file

      let match;
      const findings = [];

      /*
      |--------------------------------------------------------------------------
      | exec() loop
      |--------------------------------------------------------------------------
      | Why exec():
      | - Gives match.index
      | - Allows precise slicing of original code
      | - Prevents meaningless substring spam
      */
      while ((match = regex.exec(content)) !== null) {
        const matchedText = match[0];
        const index = match.index;

        // Context window: ±100 characters
        const start = Math.max(0, index - 100);
        const end = Math.min(content.length, index + matchedText.length + 100);

        const context = content
          .slice(start, end)
          .replace(/\s+/g, ' ') // normalize whitespace
          .trim();

        findings.push({
          match: matchedText,
          context
        });
      }

      if (findings.length === 0) continue;

      // De-dupe identical findings (same match + same context)
      const uniqueFindings = [];
      const seen = new Set();

      for (const f of findings) {
        const key = `${f.match}::${f.context}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueFindings.push(f);
        }
      }

      const relativeFile = path.relative(downloadedRootDir, filePath);

      /*
      |--------------------------------------------------------------------------
      | Machine-readable record
      |--------------------------------------------------------------------------
      */
      machineResults.push({
        file: relativeFile,
        regex: name,
        findings: uniqueFindings
      });

      /*
      |--------------------------------------------------------------------------
      | Human-readable output
      |--------------------------------------------------------------------------
      */
      humanLines.push(`File: ${relativeFile}`);
      humanLines.push(`Regex: ${name}`);
      humanLines.push('Findings:');

      for (const f of uniqueFindings) {
        humanLines.push(`- Match: ${f.match}`);
        humanLines.push(`  Context: ${f.context}`);
      }

      humanLines.push(''); // spacing
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Write outputs
  |--------------------------------------------------------------------------
  */
  const machinePath = path.join(analysisDir, 'goods_machine.json');
  fs.writeFileSync(machinePath, JSON.stringify(machineResults, null, 2));

  const humanPath = path.join(analysisDir, 'goods_human.txt');
  fs.writeFileSync(humanPath, humanLines.join('\n'));

  console.log(`[runthegoods] Machine output: ${machinePath}`);
  console.log(`[runthegoods] Human output: ${humanPath}`);
}

module.exports = runthegoods;
