// Captures error messages inside throw or console.error
module.exports = /(?:throw\s+new\s+Error|console\.error)\s*\(\s*['"`](.*?)['"`]\s*\)/g;
