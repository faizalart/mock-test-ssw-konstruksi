import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { validateQuestion, DEFAULT_PACKAGES } from '../utils.js';

const ROOT = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon'
};

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
          } else if (msg.method && this.listeners.has(msg.method)) {
            for (const fn of this.listeners.get(msg.method)) {
              fn(msg.params, msg.sessionId);
            }
          }
        } catch (e) {
          console.error('[CDP Parse Error]', e);
        }
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

  on(method, callback) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, []);
    }
    this.listeners.get(method).push(callback);
  }

  async eval(expr, sessionId = undefined) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }
}

function launchChrome(userDataDir) {
  const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  return spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-pipe',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
  });
}

async function waitForCondition(cdp, sessionId, expr, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const ok = await cdp.eval(expr, sessionId);
      if (ok) return ok;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for condition: ${expr}`);
}

async function runStaticTests() {
  console.log('--- PART 1: Static Schema, Asset & Kotoba Validation (Latsol Konstruksi 01) ---');

  const jsonPath = path.join(ROOT, 'data/latsol-konstruksi-01.json');
  assert.ok(fs.existsSync(jsonPath), 'data/latsol-konstruksi-01.json must exist');
  const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  assert.equal(pkg.setId, 'latsol-konstruksi-01', 'setId must be latsol-konstruksi-01');
  assert.equal(pkg.setName, 'Latsol Konstruksi 01', 'setName must be Latsol Konstruksi 01');
  assert.ok(pkg.field === 'KONSTRUKSI' || pkg.field.includes('建設'), 'field must be Konstruksi');
  assert.equal(pkg.totalQuestions, 50, 'totalQuestions must be 50');
  assert.equal(pkg.questions.length, 50, 'questions array length must be 50');

  const qIds = new Set();
  const hashes = new Map();
  let questionImgCount = 0;
  let optionImgCount = 0;

  for (let i = 0; i < pkg.questions.length; i++) {
    const q = pkg.questions[i];
    assert.ok(q.id, `Question #${i + 1} must have id`);
    assert.ok(!qIds.has(q.id), `Duplicate question id: ${q.id}`);
    qIds.add(q.id);

    // Schema validation via utils.js
    const errs = validateQuestion(q);
    assert.equal(errs.length, 0, `Question ${q.id} validateQuestion errors: ${JSON.stringify(errs)}`);

    // Verify 4 options A, B, C, D
    assert.equal(q.options.length, 4, `Question ${q.id} must have exactly 4 options`);
    const optIds = q.options.map(o => o.id).join('');
    assert.equal(optIds, 'ABCD', `Question ${q.id} option IDs must be ABCD`);

    assert.ok(['A', 'B', 'C', 'D'].includes(q.correctAnswer), `Question ${q.id} correctAnswer must be in A..D`);
    assert.equal(q.correctIndex, ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer), `Question ${q.id} correctIndex mismatch`);

    // Check main question image
    if (q.questionImage) {
      questionImgCount++;
      const fullImgPath = path.join(ROOT, q.questionImage);
      assert.ok(fs.existsSync(fullImgPath), `Image file missing: ${q.questionImage}`);
      const buf = fs.readFileSync(fullImgPath);
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      hashes.set(q.questionImage, h);

      // Check not full-page A4 scan
      const w = buf.readUInt32BE(16);
      const ht = buf.readUInt32BE(20);
      const isA4FullPage = (w === 1240 && ht === 1755) || (w === 2480 && ht === 3508) || (Math.abs(ht / w - 1.414) < 0.05 && ht > 2000);
      assert.ok(!isA4FullPage, `Image ${q.questionImage} appears to be full-page scan: ${w}x${ht}`);
    }

    // Check option images
    for (const opt of q.options) {
      if (opt.optionImage) {
        optionImgCount++;
        const fullOptImg = path.join(ROOT, opt.optionImage);
        assert.ok(fs.existsSync(fullOptImg), `Option image missing: ${opt.optionImage}`);
        const buf = fs.readFileSync(fullOptImg);
        const h = crypto.createHash('sha256').update(buf).digest('hex');
        hashes.set(opt.optionImage, h);
      }
    }
  }

  assert.equal(questionImgCount, 35, 'Must have 35 question images');
  assert.equal(optionImgCount, 32, 'Must have 32 option images across 8 questions');
  assert.equal(hashes.size, 67, 'Must have 67 unique image files');
  console.log(`✓ 50 questions, 35 question images, and 32 option images statically validated with 0 errors`);

  // Verify Kotoba metadata
  const extraKotoba = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kotoba-dan-kategori-tambahan.json'), 'utf8'));
  assert.ok(extraKotoba.totalEntries >= 778, 'kotoba-dan-kategori-tambahan totalEntries must be at least 778');
  for (let i = 1; i <= 50; i++) {
    const qid = `konstruksi01-q${String(i).padStart(3, '0')}`;
    assert.ok(extraKotoba.entries[qid], `Kotoba entry missing for ${qid}`);
    const cat = extraKotoba.entries[qid].category;
    assert.ok(cat.includes('Konstruksi') || cat.includes('建設') || cat.includes('土工') || cat.includes('土木') || cat.includes('工具') || cat.includes('塗装') || cat.includes('とび'), `Category for ${qid} must be construction-specific: ${cat}`);
  }
  console.log('✓ Kotoba metadata verified for all 50 questions in kotoba-dan-kategori-tambahan.json');

  // Verify sharedKotobaDictionary & kotobaMapping
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sharedKotobaDictionary.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kotobaMapping.json'), 'utf8'));
  assert.ok(Object.keys(dict.terms).length >= 5300, 'Shared dictionary must contain integrated construction terms');
  assert.ok(Object.keys(map.questions).length >= 1784, 'Mapping questions must contain at least 1784 questions');
  for (let i = 1; i <= 50; i++) {
    const qid = `konstruksi01-q${String(i).padStart(3, '0')}`;
    assert.ok(Array.isArray(map.questions[qid]), `Mapping missing for ${qid}`);
    assert.ok(map.questions[qid].length > 0, `Prompt terms empty for ${qid}`);
    for (const l of ['A', 'B', 'C', 'D']) {
      assert.ok(Array.isArray(map.options[qid]?.[l]), `Option ${l} terms missing for ${qid}`);
    }
  }
  console.log('✓ Shared dictionary & context mapping verified for all 50 questions & options A..D');

  // Service Worker check
  const swContent = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(swContent.includes('./data/latsol-konstruksi-01.json'), 'sw.js must precache latsol-konstruksi-01.json');
  assert.ok(swContent.includes("CACHE_NAME = 'ssw-pm-mock-test-shell-v37'"), 'sw.js cache must be bumped to v37');
  console.log('✓ Service Worker precaches latsol-konstruksi-01.json under v37 cache');
}

async function runBrowserTests() {
  console.log('\n--- PART 2: Real Browser / CDP Integration & Flow Verification ---');

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(ROOT, reqPath.replace(/^\//, ''));
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✓ Local test server running on ${baseUrl}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssw-test-konst-'));
  const chrome = launchChrome(userDataDir);
  const cdp = new CDPClient(chrome);

  const consoleErrors = [];
  const networkErrors = [];

  try {
    const targets = await cdp.send('Target.getTargets');
    const pageTarget = targets.targetInfos.find(t => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true
    });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    cdp.on('Runtime.consoleAPICalled', params => {
      if (params.type === 'error') {
        const text = params.args.map(a => a.value || a.description || '').join(' ');
        if (!text.includes('ServiceWorker') && !text.includes('favicon')) {
          consoleErrors.push(text);
        }
      }
    });

    cdp.on('Network.responseReceived', params => {
      const { response } = params;
      if (response.status >= 400 && !response.url.includes('favicon.ico')) {
        networkErrors.push(`${response.status} ${response.url}`);
      }
    });

    await cdp.send('Page.navigate', { url: `${baseUrl}/index.html` }, sessionId);

    // Wait for all packages including Konstruksi to be fully seeded
    await waitForCondition(cdp, sessionId, 'Boolean(window.state && window.state.questions && window.state.questions.length >= 1784)');
    const totalLoaded = await cdp.eval('window.state.questions.length', sessionId);
    console.log(`✓ App booted & seeded: ${totalLoaded} total questions in state (expected >= 1784)`);
    assert.ok(totalLoaded >= 1784, `Expected at least 1784 questions in state, got ${totalLoaded}`);

    // Check catalog presence
    const availablePkgs = await cdp.eval('window.getAvailablePackages()', sessionId);
    const konstPkg = availablePkgs.find(p => p.id === 'latsol-konstruksi-01');
    assert.ok(konstPkg, 'Latsol Konstruksi 01 must exist in getAvailablePackages()');
    assert.equal(konstPkg.total, 50, 'Konstruksi package total must be 50');
    assert.equal(konstPkg.active, 50, 'Konstruksi package active must be 50');
    console.log(`✓ Latsol Konstruksi 01 verified in catalog: 50 total, 50 active, ${konstPkg.withImage} illustrated`);

    // Verify Home Dashboard Konstruksi Filter Tab
    const tabClicked = await cdp.eval(`
      (() => {
        const btn = document.querySelector('[data-action="set-home-pkg-filter"][data-id="konstruksi"]');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `, sessionId);
    assert.ok(tabClicked, 'Home filter tab for Konstruksi must exist and be clickable');
    await new Promise(r => setTimeout(r, 300));

    const visibleRows = await cdp.eval(`
      (() => {
        const rows = [...document.querySelectorAll('.hd-pkg-row')];
        return rows.map(r => ({
          code: r.querySelector('.hd-pkg-code')?.textContent?.trim(),
          name: r.querySelector('.hd-pkg-name')?.textContent?.trim(),
          edition: r.querySelector('.hd-pkg-edition')?.textContent?.trim(),
          meta: r.querySelector('.hd-pkg-meta')?.textContent?.trim()
        }));
      })()
    `, sessionId);
    assert.equal(visibleRows.length, 1, 'Only Konstruksi package must show when Konstruksi filter is active');
    assert.equal(visibleRows[0].code, 'K01', 'Package code must be K01');
    assert.equal(visibleRows[0].name, 'Latsol Konstruksi 01', 'Package name must be Latsol Konstruksi 01');
    assert.equal(visibleRows[0].edition, 'Bidang Konstruksi', 'Edition badge must be Bidang Konstruksi');
    console.log('✓ Home Dashboard Konstruksi filter tab and K01 badge verified');

    // Helper to start package in practice or CBT mode
    async function startPackageMode(setId, mode, count) {
      await cdp.eval(`
        (async () => {
          for (const s of window.state.sessions) {
            if (s.status === 'in_progress') {
              s.status = 'completed';
              await window.put('sessions', s);
            }
          }
          window.state.activeSession = null;
          window.state.setup.mode = ${JSON.stringify(mode)};
          window.state.setup.practice = ${mode === 'practice'};
          window.state.setup.setId = ${JSON.stringify(setId)};
          window.state.setup.count = ${count};
          window.state.setup.duration = ${mode === 'practice' ? 0 : 70};
          window.state.setup.random = false;
          window.state.setup.shuffleQuestions = false;
          window.state.setup.shuffleOptions = false;
          await window.startExam();
        })()
      `, sessionId);
      await waitForCondition(cdp, sessionId, `window.state.page === "exam" && window.state.activeSession && window.state.activeSession.setId === ${JSON.stringify(setId)}`);
    }

    // TEST PRACTICE MODE FOR LATSOL KONSTRUKSI 01
    await startPackageMode('latsol-konstruksi-01', 'practice', 50);
    const navBtnsCount = await cdp.eval('document.querySelectorAll(".question-map-item").length', sessionId);
    assert.equal(navBtnsCount, 50, 'Konstruksi Practice Mode must have 50 navigator buttons');
    console.log('✓ Practice Mode launched: 50 navigator buttons present');

    // Verify Question 1 (main question image & 4 options)
    const q1Choices = await cdp.eval(`
      (() => {
        return [...document.querySelectorAll('.answer-choice')].map(c => c.querySelector('.answer-letter')?.textContent?.trim());
      })()
    `, sessionId);
    assert.deepEqual(q1Choices, ['A', 'B', 'C', 'D'], 'Question 1 must have 4 options A, B, C, D');

    await waitForCondition(cdp, sessionId, '(() => { const img = document.querySelector(".question-display-image"); return Boolean(img && img.complete && img.naturalWidth > 0); })()', 10000);
    const q1Img = await cdp.eval('(() => { const img = document.querySelector(".question-display-image"); return { src: img.src, w: img.naturalWidth, h: img.naturalHeight }; })()', sessionId);
    assert.ok(q1Img.src.includes('konstruksi01-q001.png'), 'Question 1 must render konstruksi01-q001.png');
    assert.ok(q1Img.w > 0, 'Question 1 image must load with natural width');
    console.log(`✓ Question 1 verified: 4 options A..D, image rendered (${q1Img.w}x${q1Img.h})`);

    // Verify Question 3 (has 4 option images A, B, C, D)
    await cdp.eval('window.moveExamTo(2)', sessionId); // Question #3
    await waitForCondition(cdp, sessionId, 'window.state.activeSession.currentIndex === 2');
    await waitForCondition(cdp, sessionId, '(() => { const imgs = document.querySelectorAll(".answer-choice img.answer-image"); return imgs.length === 4 && [...imgs].every(img => img.complete && img.naturalWidth > 0); })()', 10000);

    const q3Opts = await cdp.eval(`
      (() => {
        return [...document.querySelectorAll('.answer-choice img.answer-image')].map(img => ({
          src: img.src,
          loaded: img.complete && img.naturalWidth > 0,
          w: img.naturalWidth,
          h: img.naturalHeight
        }));
      })()
    `, sessionId);

    assert.equal(q3Opts.length, 4, 'Question 3 must render exactly 4 option images (A..D)');
    for (let i = 0; i < 4; i++) {
      const letter = ['a', 'b', 'c', 'd'][i];
      assert.ok(q3Opts[i].src.includes(`konstruksi01-q003-option-${letter}.png`), `Option ${letter} must load option-${letter}.png`);
      assert.ok(q3Opts[i].loaded, `Option ${letter} image must have naturalWidth > 0`);
    }
    console.log('✓ Question 3 verified: 4 separate option images (A..D) rendered & loaded with natural dimensions');

    // Test Kotoba toggle on prompt and option D
    await cdp.eval(`
      (() => {
        const promptKotobaBtn = document.querySelector('[data-action="toggle-selective-kotoba"][data-target-type="prompt"]');
        if (promptKotobaBtn) promptKotobaBtn.click();
        const optDKotobaBtn = document.querySelector('[data-action="toggle-selective-kotoba"][data-opt-key="konstruksi01-q003::D"]');
        if (optDKotobaBtn) optDKotobaBtn.click();
      })()
    `, sessionId);

    await waitForCondition(cdp, sessionId, 'document.querySelectorAll(".practice-kotoba-item").length >= 1', 10000);
    const kotobaHtmlCount = await cdp.eval('document.querySelectorAll(".practice-kotoba-item").length', sessionId);
    assert.ok(kotobaHtmlCount > 0, `Kotoba terms must render in practice list (got ${kotobaHtmlCount})`);
    console.log(`✓ Contextual Kotoba verified on Question 3: prompt & Option D Kotoba rendered (${kotobaHtmlCount} terms)`);

    // TEST CBT MODE FOR LATSOL KONSTRUKSI 01
    await startPackageMode('latsol-konstruksi-01', 'full', 50);
    const cbtNavCount = await cdp.eval('document.querySelectorAll(".question-map-item").length', sessionId);
    assert.equal(cbtNavCount, 50, 'CBT Mode must have 50 navigator buttons');

    // Verify Question 50 accessible
    await cdp.eval('window.moveExamTo(49)', sessionId); // Question #50
    await waitForCondition(cdp, sessionId, 'window.state.activeSession.currentIndex === 49');
    await waitForCondition(cdp, sessionId, '(() => { const img = document.querySelector(".question-display-image"); return Boolean(img && img.complete && img.naturalWidth > 0); })()', 10000);
    console.log('✓ Question 50 CBT navigation and image verified');

    // Submit CBT Exam and verify review
    await cdp.eval(`
      (async () => {
        for (let i = 0; i < 50; i++) {
          const q = window.state.activeSession.questions[i];
          window.state.activeSession.answers[q.id] = q.correctIndex;
        }
        await window.finishExam(false, true);
      })()
    `, sessionId);

    await waitForCondition(cdp, sessionId, 'Boolean(document.querySelector(".zen-result-page, .exam-result, .result-score-block"))');
    console.log('✓ CBT Mode full session & scoring evaluation verified for Latsol Konstruksi 01');

    assert.equal(networkErrors.length, 0, `Network errors detected: ${JSON.stringify(networkErrors)}`);
    assert.equal(consoleErrors.length, 0, `Console errors detected: ${JSON.stringify(consoleErrors)}`);
    console.log('✓ Zero HTTP 404 asset errors detected');
    console.log('✓ Zero JavaScript runtime console errors detected');

  } finally {
    try { chrome.kill(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  console.log('================================================================');
  console.log('TEST SUITE: INTEGRATION OF LATSOL KONSTRUKSI 01');
  console.log('================================================================');
  await runStaticTests();
  await runBrowserTests();
  console.log('\n================================================================');
  console.log('LATSOL KONSTRUKSI 01 INTEGRATION TESTS PASSED (100%)!');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
