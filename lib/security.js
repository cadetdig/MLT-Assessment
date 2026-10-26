'use strict';
const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function hashPassword(password, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(password, salt, hash) {
  if (typeof password !== 'string' || !salt || !hash || password.length > 256) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 64, SCRYPT);
  const expected = Buffer.from(hash, 'base64');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256)
    throw new AppError(400, 'Choose a password of at least 10 characters.');
}

function normalizeUsername(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9._@+-]{3,64}$/.test(name))
    throw new AppError(400, 'Usernames use 3–64 letters, numbers, or . _ - @ + (an email address works well).');
  return name;
}

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const id = () => crypto.randomUUID();

// Friendly one-time recovery key, e.g. 7K2M-9QXD-4HPV-WT8R-JC6N
function recoveryKey() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) { out += alphabet[bytes[i] % alphabet.length]; if (i % 4 === 3 && i < 19) out += '-'; }
  return out;
}
const normalizeRecoveryKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Readable temporary password for participant resets.
function tempPassword() {
  const words = ['maple', 'river', 'cedar', 'harbor', 'summit', 'meadow', 'canyon', 'willow', 'beacon', 'orchard', 'granite', 'lantern'];
  const pick = () => words[crypto.randomInt(words.length)];
  return pick() + '-' + pick() + '-' + crypto.randomInt(1000, 9999);
}

function encryptBackup(json, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(json, 'utf8')), cipher.final()]);
  return {
    format: 'PREVIAN-BACKUP-1',
    created: new Date().toISOString(),
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
  };
}

function decryptBackup(envelope, password) {
  if (!envelope || envelope.format !== 'PREVIAN-BACKUP-1') throw new AppError(400, 'Choose a Previan backup file (.previanbackup).');
  try {
    const key = crypto.scryptSync(String(password || ''), Buffer.from(envelope.salt, 'base64'), 32, SCRYPT);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError(400, 'That password does not open this backup, or the file is damaged.');
  }
}

module.exports = {
  AppError, hashPassword, verifyPassword, checkPassword, normalizeUsername,
  token, sha256, id, recoveryKey, normalizeRecoveryKey, tempPassword, encryptBackup, decryptBackup,
};
