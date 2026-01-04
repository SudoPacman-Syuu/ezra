// Node.js core modules
const fs = require('fs');           // Provides file system access, allows reading/writing files, directories, checking existence
const path = require('path');       // Utilities for manipulating file and folder paths in an OS-agnostic way
const { URL } = require('url');     // Standard URL parsing/resolution, ensures we can extract hostnames and properly handle relative URLs

// External dependencies for JavaScript parsing
const acorn = require('acorn');     // Parses JS source code into an Abstract Syntax Tree (AST) to statically analyze code
const walk = require('acorn-walk'); // Traverses the AST safely, visiting each node type (needed to detect axios/fetch calls and variable assignments)

// --- Helper Functions ---

/**
 * Compute the path to the downloaded JS directory for a given site.
 * We use hostname as folder name to isolate different sites.
 */
function getJsDir(siteUrl) {
  const hostname = new URL(siteUrl).hostname; // Parse URL and extract hostname, e.g., 'www.example.com'
  return path.join(__dirname, '..', 'scrapelists', hostname, 'downloaded-js'); 
  // Folder structure: project_root/scrapelists/<hostname>/downloaded-js/
  // Purpose: keeps downloaded JS files organized per site
}

/**
 * Compute the output path for JSON analysis.
 * Stores findings in a separate analysis folder per site.
 */
function getOutputPath(siteUrl) {
  const hostname = new URL(siteUrl).hostname;
  return path.join(__dirname, '..', 'scrapelists', hostname, 'analysis', 'js_request_surface.json');
  // This keeps the analysis separate from the downloaded JS, avoids accidental overwrites
}

/**
 * Recursively collect all JS files from a directory.
 * Allows us to handle nested folders, preserving file structure.
 */
function getAllJsFiles(dir) {
  let results = []; // Initialize array to store file paths

  for (const file of fs.readdirSync(dir)) {   // Read all entries (files/folders) in the directory
    const full = path.join(dir, file);        // Resolve to full OS-independent path
    const stat = fs.statSync(full);           // Get metadata for the entry

    if (stat.isDirectory()) {                 // If entry is a folder
      results = results.concat(getAllJsFiles(full)); // Recursively collect JS files from subfolder
    } else if (file.endsWith('.js')) {       // Only process files ending with '.js'
      results.push(full);                     // Add JS file to results array
    }
  }

  return results;                             // Return a complete list of JS file paths
}

/**
 * Extract keys from a JS ObjectExpression (literal).
 * This is used to determine body parameter names in POST requests.
 */
function extractObjectKeysFromNode(node) {
  if (!node || node.type !== 'ObjectExpression') return []; 
  // Guard clause: skip invalid nodes or non-object types

  return node.properties
    .filter(p => p.key && (p.key.name || (p.key.value && typeof p.key.value === 'string')))
    // Only include properties with valid keys (either Identifier or Literal string)
    .map(p => p.key.name || p.key.value); 
    // Return key names as strings
}

/**
 * Extract keys from FormData by tracking .append() calls.
 * FormData does not expose its keys in AST, so we must detect append() invocations.
 */
function extractFormDataKeys(scope, variableName) {
  if (!scope[variableName] || !scope[variableName].appends) return []; // Return empty if nothing tracked
  return scope[variableName].appends; // Return array of keys that were appended
}

/**
 * Extract keys from URLSearchParams by tracking .append() calls.
 * URLSearchParams are often used for application/x-www-form-urlencoded payloads.
 */
function extractUrlSearchParamsKeys(scope, variableName) {
  if (!scope[variableName] || !scope[variableName].appends) return [];
  return scope[variableName].appends;
}

// --- Core Extraction Function ---
/**
 * Main function: analyze JS files to detect modifiable HTTP requests.
 * Detects axios/fetch calls, tracks body parameters, and classifies request types.
 */
function extractRequests(siteUrl) {
  const jsDir = getJsDir(siteUrl); // Determine folder containing JS files

  if (!fs.existsSync(jsDir)) {     // Validate folder exists before continuing
    console.error(`JS directory not found: ${jsDir}`);
    return;                        // Exit early if folder missing
  }

  const files = getAllJsFiles(jsDir); // Collect all JS files recursively
  const findings = [];                 // Initialize array for storing findings

  for (const file of files) {          // Iterate through each JS file
    const content = fs.readFileSync(file, 'utf-8'); // Load file contents as string
    let ast;

    try {
      ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' }); 
      // Parse JS into AST for static analysis
      // ecmaVersion: 'latest' ensures support for modern JS syntax
      // sourceType: 'module' allows detection of import/export statements
    } catch {
      continue; // Skip files that cannot be parsed (minified/broken/ES syntax not supported)
    }

    const scope = {}; // Object to track variable assignments (ObjectExpression, FormData, URLSearchParams)

    walk.ancestor(ast, {
      // --- Track variable declarations ---
      VariableDeclarator(node) {
        if (node.init) {
          // Object literals: const data = { key: value }
          if (node.init.type === 'ObjectExpression' && node.id.type === 'Identifier') {
            scope[node.id.name] = node.init; 
            // Store object in scope for later reference in axios/fetch bodies
          }
          // FormData instances
          if (node.init.type === 'NewExpression' && node.init.callee.name === 'FormData') {
            if (node.id.type === 'Identifier') scope[node.id.name] = { type: 'FormData', appends: [] };
          }
          // URLSearchParams instances
          if (node.init.type === 'NewExpression' && node.init.callee.name === 'URLSearchParams') {
            if (node.id.type === 'Identifier') scope[node.id.name] = { type: 'URLSearchParams', appends: [] };
          }
        }
      },

      // --- Track assignment expressions ---
      AssignmentExpression(node) {
        if (node.left.type === 'Identifier') {
          if (node.right.type === 'ObjectExpression') scope[node.left.name] = node.right;
          // Allow reassignment of variables to new object literals
        }
      },

      // --- Track function calls ---
      CallExpression(node) {

        // --- Track FormData.append() or URLSearchParams.append() ---
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.name === 'append' &&
          node.callee.object.type === 'Identifier'
        ) {
          const varName = node.callee.object.name;
          if (scope[varName] && Array.isArray(scope[varName].appends)) {
            if (node.arguments.length > 0) {
              const keyArg = node.arguments[0];
              if (keyArg.type === 'Literal') scope[varName].appends.push(keyArg.value);
              // Save appended key to scope for later body param extraction
            }
          }
        }

        // --- Detect axios calls (POST/PUT/PATCH/DELETE) ---
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.name === 'axios' &&
          ['post', 'put', 'patch', 'delete'].includes(node.callee.property.name)
        ) {
          const method = node.callee.property.name.toUpperCase(); // HTTP method
          let endpoint = null;
          let bodyParams = [];
          let bodyType = 'unknown'; // Will store type: json | form-data | urlencoded | unknown

          // Extract URL endpoint
          if (node.arguments.length > 0) {
            const arg0 = node.arguments[0];
            if (arg0.type === 'Literal') endpoint = arg0.value;
            else if (arg0.type === 'TemplateLiteral') endpoint = arg0.quasis.map(q => q.value.raw).join('${}');
          }

          // Extract body
          if (node.arguments.length > 1) {
            const bodyArg = node.arguments[1];

            if (bodyArg.type === 'ObjectExpression') {
              bodyParams = extractObjectKeysFromNode(bodyArg);
              bodyType = 'json';
            } else if (bodyArg.type === 'Identifier' && scope[bodyArg.name]) {
              if (scope[bodyArg.name].type === 'FormData') {
                bodyParams = extractFormDataKeys(scope, bodyArg.name);
                bodyType = 'form-data';
              } else if (scope[bodyArg.name].type === 'URLSearchParams') {
                bodyParams = extractUrlSearchParamsKeys(scope, bodyArg.name);
                bodyType = 'urlencoded';
              } else if (scope[bodyArg.name].type === 'ObjectExpression') {
                bodyParams = extractObjectKeysFromNode(scope[bodyArg.name]);
                bodyType = 'json';
              }
            }
          }

          findings.push({ file, method, endpoint, bodyParams, bodyType, confidence: 'high' });
        }

        // --- Detect fetch() calls ---
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          let endpoint = null;
          let method = 'GET';
          let bodyParams = [];
          let bodyType = 'unknown';

          if (node.arguments.length > 0) {
            const arg0 = node.arguments[0];
            if (arg0.type === 'Literal') endpoint = arg0.value;
            else if (arg0.type === 'TemplateLiteral') endpoint = arg0.quasis.map(q => q.value.raw).join('${}');
          }

          if (node.arguments.length > 1) {
            const options = node.arguments[1];
            if (options.type === 'ObjectExpression') {
              // Extract method if specified
              const methodProp = options.properties.find(p => p.key?.name === 'method');
              if (methodProp && methodProp.value.type === 'Literal') method = methodProp.value.value.toUpperCase();

              // Extract body
              const bodyProp = options.properties.find(p => p.key?.name === 'body');
              if (bodyProp) {
                const bodyVal = bodyProp.value;
                if (bodyVal.type === 'ObjectExpression') {
                  bodyParams = extractObjectKeysFromNode(bodyVal);
                  bodyType = 'json';
                } else if (bodyVal.type === 'Identifier' && scope[bodyVal.name]) {
                  if (scope[bodyVal.name].type === 'FormData') {
                    bodyParams = extractFormDataKeys(scope, bodyVal.name);
                    bodyType = 'form-data';
                  } else if (scope[bodyVal.name].type === 'URLSearchParams') {
                    bodyParams = extractUrlSearchParamsKeys(scope, bodyVal.name);
                    bodyType = 'urlencoded';
                  } else if (scope[bodyVal.name].type === 'ObjectExpression') {
                    bodyParams = extractObjectKeysFromNode(scope[bodyVal.name]);
                    bodyType = 'json';
                  }
                }
              }
            }
          }

          if (endpoint || bodyParams.length) {
            findings.push({ file, method, endpoint, bodyParams, bodyType, confidence: 'medium' });
          }
        }
      },
    });
  }

  // --- Write findings to JSON ---
  const outPath = getOutputPath(siteUrl);       // Determine file path for output
  const outDir = path.dirname(outPath);         // Ensure directory exists
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); // Create folder recursively if missing

  fs.writeFileSync(outPath, JSON.stringify(findings, null, 2)); // Save JSON with 2-space indentation
  console.log(`Modifiable request surface saved to: ${outPath}`); // Log success
  return findings;
}

// Export function for external usage
module.exports = extractRequests;
