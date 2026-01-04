// Matches FLAG_XXXX, SECRET_FLAG_XXXX, FLAG-XXXX patterns
module.exports = /\b(?:FLAG|SECRET_FLAG)[-_]?[A-Z0-9]{4,}\b/g;
