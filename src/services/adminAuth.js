const crypto = require('crypto');

const COOKIE_NAME = 'cy_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const createError = (message, status) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const getSecret = () => process.env.ADMIN_SESSION_SECRET || 'change-this-admin-session-secret';

const parseCookies = (cookieHeader = '') => {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
};

const sign = (value) => {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
};

const createSessionToken = () => {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}.${signature}`, 'utf8').toString('base64url');
};

const verifySessionToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [expiresAtRaw, signature] = decoded.split('.');
    if (!expiresAtRaw || !signature) return false;

    const expected = sign(expiresAtRaw);
    if (expected !== signature) return false;

    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt)) return false;
    if (expiresAt < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
};

const buildCookie = (token) => {
  const securePart = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${securePart}`;
};

const buildExpiredCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const checkAdminCredentials = (username, password) => {
  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  return username === expectedUsername && password === expectedPassword;
};

const requireAdmin = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token || !verifySessionToken(token)) {
    return next(createError('Unauthorized admin access.', 401));
  }
  return next();
};

module.exports = {
  checkAdminCredentials,
  createSessionToken,
  buildCookie,
  buildExpiredCookie,
  requireAdmin
};
