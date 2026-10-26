'use strict';
// Simple, durable storage: one JSON file kept in memory and saved atomically
// (write to a temporary file, then rename), plus rolling daily backups.
const fs = require('fs');
const path = require('path');
const { defaultLibrary } = require('./library');

const BACKUPS_KEPT = 30;

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'previan-data.json');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.data = this.load();
    this.timer = null;
  }

  blank() {
    return {
      format: 'PREVIAN-DATA-1',
      settings: {},
      users: {},
      admins: {},
      sessions: {},
      library: defaultLibrary(),
      assessments: {},
      invitations: {},
    };
  }

  load() {
    for (const candidate of [this.file, this.file + '.tmp']) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (data && data.format === 'PREVIAN-DATA-1') return this.upgrade(data);
      } catch { /* try the next candidate */ }
    }
    if (fs.existsSync(this.file)) {
      throw new Error('The data file ' + this.file + ' could not be read. It has not been changed. Restore it from the backups folder.');
    }
    return this.blank();
  }

  upgrade(data) {
    const blank = this.blank();
    for (const key of Object.keys(blank)) if (data[key] === undefined) data[key] = blank[key];
    return data;
  }

  // Save soon (coalesces bursts such as draft autosaves).
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400);
  }

  // Save now (used for submissions and account changes).
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    const body = JSON.stringify(this.data);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    this.dailyBackup(body);
  }

  dailyBackup(body) {
    const name = 'auto-' + new Date().toISOString().slice(0, 10) + '.json';
    const target = path.join(this.backupDir, name);
    try {
      fs.writeFileSync(target, body, { mode: 0o600 });
      const old = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('auto-')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) fs.unlinkSync(path.join(this.backupDir, f));
    } catch { /* a failed extra copy must never block saving */ }
  }

  replaceAll(data) {
    const before = path.join(this.backupDir, 'before-restore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(before, JSON.stringify(this.data), { mode: 0o600 });
    this.data = this.upgrade(data);
    this.flush();
    return path.basename(before);
  }
}

module.exports = { Store };
