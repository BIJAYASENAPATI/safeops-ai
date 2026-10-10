/**
 * Normalizes a phone number string by stripping formatting characters
 * (spaces, hyphens, brackets, dots) and standardizing the country prefix.
 *
 * @param {string} phone
 * @returns {string|null} Normalized phone number string, or null if empty/invalid type
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== "string") {
    return null;
  }

  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, "");
  if (!cleaned) {
    return null;
  }

  // Convert international double-zero dialing prefix (00) to +
  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.slice(2);
  }

  // If 10 digits without leading +, assume standard Indian mobile format (+91)
  if (/^\d{10}$/.test(cleaned)) {
    cleaned = "+91" + cleaned;
  } else if (/^\d{11,15}$/.test(cleaned)) {
    // Digits without + prefix, add leading +
    cleaned = "+" + cleaned;
  }

  return cleaned;
}

/**
 * Validates whether the normalized string adheres to the standard E.164 phone format
 * (e.g. + followed by 7 to 15 digits, starting with country code 1-9)
 *
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== "string") {
    return false;
  }
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

module.exports = { normalizePhoneNumber, isValidPhoneNumber, };