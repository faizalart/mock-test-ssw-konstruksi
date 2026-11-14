import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ARTIFACT_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/df48c839-4418-4fdf-921c-2b7f0a0eb3bf';
const htmlFile = path.join(ARTIFACT_DIR, 'contact-sheet-konstruksi.html');
const outPng = path.join(ARTIFACT_DIR, 'contact-sheet-konstruksi.png');

class CDPClient {
  constructor(chromeProcess) {
    this.chrome = chromeProcess;
    this.pipeWrite = chromeProcess.stdio[3];
    this.pipeRead = chromeProcess.stdio[4];
    this.msgId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.buf = Buffer.alloc(0);

    this.pipeRead.on('data', chunk => {
      this.buf = Buffer.concat([this.buf, chunk]);
      let idx;
      while ((idx = this.buf.indexOf(0)) !== -1) {
        const raw = this.buf.subarray(0, idx).toString('utf8');
        this.buf = this.buf.subarray(idx + 1);
        if (!raw) continue;
        try {
          const msg = JSON.parse(raw);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch (e) {}
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.msgId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.pipeWrite.write(JSON.stringify(payload) + '\0');
    });
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cs-'));
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tmpDir}`,
    '--remote-debugging-pipe',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
  });

  const cdp = new CDPClient(chrome);
  const targets = await cdp.send('Target.getTargets');
  const pageTarget = targets.targetInfos.find(t => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: pageTarget.targetId,
    flatten: true
  });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);

  const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');
  await cdp.send('Page.navigate', { url: fileUrl }, sessionId);
  await new Promise(r => setTimeout(r, 2000));

  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1440, height: 2400, scale: 1 }
  }, sessionId);

  fs.writeFileSync(outPng, Buffer.from(screenshot.data, 'base64'));
  console.log('Saved contact sheet screenshot:', outPng);

  chrome.kill('SIGKILL');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(console.error);
