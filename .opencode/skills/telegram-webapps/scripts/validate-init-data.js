/**
 * Telegram Mini App initData validation — drop this file into the project as-is.
 *
 * Usage:
 *   const { validateInitData, requireTelegramAuth } = require('./validate-init-data');
 *
 *   // Express:
 *   app.post('/api/action', requireTelegramAuth, (req, res) => {
 *     console.log(req.telegramUser.id); // verified user
 *   });
 *
 *   // Manual:
 *   const { valid, user, data } = validateInitData(rawInitData, process.env.BOT_TOKEN);
 */

'use strict';

const crypto = require('crypto');

/**
 * @param {string} rawInitData  - tg.initData from the Mini App
 * @param {string} botToken     - your bot token from BotFather
 * @param {number} maxAgeSec    - reject data older than this (default 3600 = 1 hour)
 * @returns {{ valid: boolean, user: object|null, data: Record<string,string> }}
 */
function validateInitData(rawInitData, botToken, maxAgeSec = 3600) {
  if (!rawInitData || !botToken) return { valid: false, user: null, data: {} };

  let params;
  try {
    params = new URLSearchParams(rawInitData);
  } catch {
    return { valid: false, user: null, data: {} };
  }

  const receivedHash = params.get('hash');
  if (!receivedHash) return { valid: false, user: null, data: {} };
  params.delete('hash');

  // 1. Sort fields alphabetically and join as "key=value\n..."
  // Note: only "hash" is excluded for HMAC. The "signature" field (Bot API 8.0+), if present,
  // IS included in the check string for HMAC validation (unlike Ed25519 where both are excluded).
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // 2. secret = HMAC-SHA256("WebAppData", botToken)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  // 3. expected = HMAC-SHA256(secret, checkString)
  const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  // 4. Constant-time compare (prevents timing oracle attacks)
  const recv = Buffer.from(receivedHash, 'hex');
  const exp  = Buffer.from(expectedHash, 'hex');
  if (recv.length !== exp.length || !crypto.timingSafeEqual(recv, exp)) {
    return { valid: false, user: null, data: {} };
  }

  // 5. Check freshness
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > maxAgeSec) {
    return { valid: false, user: null, data: {} };
  }

  // 6. Parse user JSON
  let user = null;
  const userStr = params.get('user');
  if (userStr) {
    try { user = JSON.parse(userStr); }
    catch { return { valid: false, user: null, data: {} }; }
  }

  return { valid: true, user, data: Object.fromEntries(params) };
}

/**
 * Express middleware. Reads Authorization: tma <initData>, validates,
 * then attaches req.telegramUser and req.initData. Returns 401 on failure.
 */
function requireTelegramAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('tma ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error('[telegram-auth] BOT_TOKEN is not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const { valid, user, data } = validateInitData(header.slice(4), botToken);
  if (!valid) return res.status(401).json({ error: 'Invalid or expired initData' });

  req.telegramUser = user;
  req.initData = data;
  next();
}

module.exports = { validateInitData, requireTelegramAuth };
