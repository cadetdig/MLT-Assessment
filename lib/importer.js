'use strict';
// Turns an uploaded Word (.docx), CSV, or text file into lines of text that the
// Question Library's import screen can preview. No outside software needed.
const zlib = require('zlib');
const { AppError } = require('./security');

function readZipEntry(buf, wanted) {
  // Find the "end of central directory" record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new AppError(400, 'This file is not a readable Word (.docx) document.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lnLen = buf.readUInt16LE(local + 26);
      const leLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lnLen + leLen;
      const raw = buf.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 });
      throw new AppError(400, 'This Word document uses an unsupported compression method.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new AppError(400, 'This file does not look like a Word (.docx) document.');
}

const decode = (s) => s
  .replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function docxLines(buf) {
  const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');
  const body = xml.replace(/^[\s\S]*?<w:body>/, '').replace(/<\/w:body>[\s\S]*$/, '');
  const lines = [];
  // Walk the body: tables become one line per row, cells joined by " | ".
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(body))) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl>')) {
      for (const row of chunk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((c) =>
          (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(decode).filter(Boolean).join(' '));
        const line = cells.filter((c) => c !== '').join(' | ');
        if (line) lines.push(line);
      }
    } else {
      const text = decode(chunk);
      if (text) lines.push(text);
    }
  }
  return lines;
}

function extractLines(filename, dataBase64) {
  const name = String(filename || '').toLowerCase();
  const buf = Buffer.from(String(dataBase64 || ''), 'base64');
  if (!buf.length) throw new AppError(400, 'The file is empty.');
  if (buf.length > 15 * 1024 * 1024) throw new AppError(413, 'Please choose a file smaller than 15 MB.');
  if (name.endsWith('.docx')) return docxLines(buf);
  if (name.endsWith('.doc')) throw new AppError(400, 'This is an older Word (.doc) file. Open it in Word, choose File → Save As → Word Document (.docx), then upload the new file. Or copy the questions and paste them into the box instead.');
  if (name.endsWith('.pdf')) throw new AppError(400, 'PDF files cannot be read reliably. Copy the questions from the PDF and paste them into the box instead.');
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    return buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  throw new AppError(400, 'Upload a Word (.docx), CSV, or text file — or paste the questions into the box.');
}

module.exports = { extractLines };
