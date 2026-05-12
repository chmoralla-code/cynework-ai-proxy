/**
 * Validates and sanitizes a chat message.
 * @param {string} message - The input message.
 * @returns {string} The sanitized message.
 * @throws {Error} If the message is invalid or empty after sanitization.
 */
const validateMessage = (message) => {
  if (typeof message !== 'string') {
    throw new Error('Message must be a string');
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new Error('Message cannot be empty');
  }

  if (trimmed.length > 4000) {
    throw new Error('Message exceeds maximum length of 4000 characters');
  }

  // Basic sanitization
  const sanitized = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  return sanitized;
};

/**
 * Validates a session ID.
 * @param {string} sessionId
 * @returns {string} The validated session ID
 */
const validateSessionId = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        throw new Error('Invalid session ID');
    }
    // simple alphanumeric check to prevent injection
    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        throw new Error('Session ID contains invalid characters');
    }
    return sessionId;
}

/**
 * Validates an image object.
 * @param {Object} image - The image object containing data and mimeType.
 * @returns {Object|null} The validated image object or null if none provided.
 * @throws {Error} If the image format is invalid.
 */
const validateImage = (image) => {
  if (!image) return null;
  
  if (typeof image !== 'object') {
    throw new Error('Image must be an object');
  }

  let { data, mimeType } = image;

  if (typeof data !== 'string' || typeof mimeType !== 'string') {
    throw new Error('Image must contain data (base64 string) and mimeType (string)');
  }

  const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    if (!mimeType || mimeType === 'image') mimeType = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }

  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();

  const inferMimeTypeFromBase64 = (base64) => {
    const signature = String(base64 || '').slice(0, 16);
    if (signature.startsWith('iVBORw0KGgo')) return 'image/png';
    if (signature.startsWith('/9j/')) return 'image/jpeg';
    if (signature.startsWith('R0lGOD')) return 'image/gif';
    if (signature.startsWith('UklGR')) return 'image/webp';
    if (signature.startsWith('Qk')) return 'image/bmp';
    return null;
  };

  let safeMimeType = normalizedMimeType;
  if (safeMimeType === 'image' || !safeMimeType.startsWith('image/')) {
    const inferred = inferMimeTypeFromBase64(data);
    if (inferred) safeMimeType = inferred;
  }

  if (!safeMimeType.startsWith('image/')) {
    throw new Error('Invalid mimeType. Must be an image.');
  }

  // Basic base64 validation (rough check)
  if (!/^[A-Za-z0-9+/_=-]+$/.test(data)) {
    throw new Error('Invalid image data format. Must be base64.');
  }

  // Limit size to roughly ~5MB (base64 length approx 5MB * 1.33 = ~6.6M chars)
  if (data.length > 7000000) {
      throw new Error('Image size exceeds 5MB limit.');
  }

  return { data, mimeType: safeMimeType };
};

const validateThinkingLevel = (thinkingLevel) => {
  const normalized = (thinkingLevel || 'low').toString().trim().toLowerCase();
  if (!['low', 'medium', 'high', 'ultra', 'god'].includes(normalized)) {
    throw new Error('Invalid thinking level. Use low, medium, high, ultra, or god.');
  }
  return normalized;
};

const validatePlan = (plan) => {
  const normalized = (plan || '').toString().trim().toLowerCase();
  if (!['daily', 'monthly', 'yearly'].includes(normalized)) {
    throw new Error('Invalid plan. Use daily, monthly, or yearly.');
  }
  return normalized;
};

module.exports = {
  validateMessage,
  validateSessionId,
  validateImage,
  validateThinkingLevel,
  validatePlan
};
