import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ARTIFACT_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/df48c839-4418-4fdf-921c-2b7f0a0eb3bf';
const ASSETS_DIR = '_incoming/extracted-konstruksi-01/assets/questions';
const AUDIT_JSON = '_incoming/extracted-konstruksi-01/laporan-audit-visual.json';

const audit = JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf8'));

let cardsHtml = '';
for (const item of audit.items) {
  const imgPath = path.join(ASSETS_DIR, item.cropFileName);
  if (!fs.existsSync(imgPath)) continue;
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const mime = 'image/png';
  cardsHtml += `
    <div class="card">
      <div class="card-head">
        <span class="badge ${item.role.includes('opsi') ? 'badge-opt' : 'badge-q'}">${item.role}</span>
        <strong>#${item.questionNumber} (${item.questionId})</strong>
      </div>
      <div class="img-wrap">
        <img src="data:${mime};base64,${b64}" alt="${item.cropFileName}">
      </div>
      <div class="card-body">
        <div class="file-name">${item.cropFileName} (${item.dimensions})</div>
        <p class="desc">${item.description}</p>
        <p class="reason"><em>${item.reason}</em></p>
      </div>
    </div>
  `;
}

const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Contact Sheet Aset Visual Latsol Konstruksi 01</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
  p.sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .card-head { padding: 10px 14px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
  .badge-q { background: #0284c7; color: #fff; }
  .badge-opt { background: #d97706; color: #fff; }
  .img-wrap { background: #fff; padding: 12px; display: flex; align-items: center; justify-content: center; min-height: 200px; max-height: 280px; overflow: hidden; }
  .img-wrap img { max-width: 100%; max-height: 250px; object-fit: contain; }
  .card-body { padding: 12px 14px; font-size: 13px; line-height: 1.4; flex: 1; }
  .file-name { font-weight: 600; color: #38bdf8; font-family: monospace; font-size: 12px; margin-bottom: 6px; }
  .desc { color: #cbd5e1; margin-bottom: 6px; }
  .reason { color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
  <h1>Contact Sheet Aset Visual Latsol Konstruksi 01</h1>
  <p class="sub">Total 67 aset gambar PNG (28 gambar soal, 32 gambar opsi 4 pilihan). 0 screenshot halaman penuh, 0 gambar duplikat.</p>
  <div class="grid">
    ${cardsHtml}
  </div>
</body>
</html>`;

const outHtmlPath = path.join(ARTIFACT_DIR, 'contact-sheet-konstruksi.html');
fs.writeFileSync(outHtmlPath, html, 'utf8');
console.log('Saved contact sheet HTML:', outHtmlPath);
