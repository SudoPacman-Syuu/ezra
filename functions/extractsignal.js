const fs = require('fs');
const path = require('path');

/**
 * Reads goods_machine.json and filters "signal" matches from "trash".
 * Writes the filtered results to a new JSON file in the same folder.
 *
 * @param {string} jsonFile - Absolute path to goods_machine.json
 * @returns {string} - Path to the new signals JSON file
 */
function extractSignal(jsonFile) {
  if (!fs.existsSync(jsonFile)) {
    throw new Error(`[extractSignal] File not found: ${jsonFile}`);
  }

  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const signals = [];

  for (const entry of data) {
    const { file, regex, findings } = entry;

    for (const f of findings) {
      const m = f.match;
      const ctx = f.context;

      // Minimal filtering: ignore trivial matches
      if (
        typeof m === 'string' &&
        m.length > 3 &&
        !['user', 'type', 'id', 'context', 'set', 'value'].includes(m.toLowerCase()) &&
        !/^\d+$/.test(m)
      ) {
        signals.push({
          file,
          regex,
          match: m,
          context: ctx
        });
      }
    }
  }

  // Prepare output file path dynamically
  const dir = path.dirname(jsonFile);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(dir, `goods_signals_${timestamp}.json`);

  fs.writeFileSync(outFile, JSON.stringify(signals, null, 2), 'utf8');

  return outFile;
}

module.exports = extractSignal;
