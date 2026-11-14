import fs from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';

const ROOT = process.cwd();
const EXTRACTED_DIR = path.join(ROOT, '_incoming/extracted-konstruksi-01');

console.log('=== STEP 1: Copy latsol-konstruksi-01.json to data/ ===');
const srcJson = path.join(EXTRACTED_DIR, 'latsol-konstruksi-01.json');
const destJson = path.join(ROOT, 'data/latsol-konstruksi-01.json');
fs.copyFileSync(srcJson, destJson);
console.log('Copied to', destJson);

console.log('=== STEP 2: Copy all 67 PNGs to assets/questions/ ===');
const srcAssets = path.join(EXTRACTED_DIR, 'assets/questions');
const destAssets = path.join(ROOT, 'assets/questions');
const pngFiles = fs.readdirSync(srcAssets);
let copiedImages = 0;
for (const f of pngFiles) {
  fs.copyFileSync(path.join(srcAssets, f), path.join(destAssets, f));
  copiedImages++;
}
console.log(`Copied ${copiedImages} images to assets/questions/`);

console.log('=== STEP 3: Update kotoba-dan-kategori-tambahan.json ===');
const srcKotobaExtra = path.join(EXTRACTED_DIR, 'kotoba-dan-kategori-tambahan.json');
const destKotobaExtra = path.join(ROOT, 'data/kotoba-dan-kategori-tambahan.json');
const incomingExtra = JSON.parse(fs.readFileSync(srcKotobaExtra, 'utf8'));
const currentExtra = JSON.parse(fs.readFileSync(destKotobaExtra, 'utf8'));

// Verify that all current entries are preserved
for (const [k, v] of Object.entries(currentExtra.entries)) {
  if (!incomingExtra.entries[k]) {
    incomingExtra.entries[k] = v;
  }
}
incomingExtra.totalEntries = Object.keys(incomingExtra.entries).length;
fs.writeFileSync(destKotobaExtra, JSON.stringify(incomingExtra, null, 2) + '\n', 'utf8');
console.log(`Updated kotoba-dan-kategori-tambahan.json: totalEntries=${incomingExtra.totalEntries}`);

console.log('=== STEP 4: Integrate Kotoba into sharedKotobaDictionary and kotobaMapping ===');
const dictPath = path.join(ROOT, 'data/sharedKotobaDictionary.json');
const mapPath = path.join(ROOT, 'data/kotobaMapping.json');
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

const kData = JSON.parse(fs.readFileSync(destJson, 'utf8'));

// Build lookup of existing terms in dictionary
// Map: kanji|furigana -> termId
const termLookup = new Map();
for (const [id, t] of Object.entries(dict.terms)) {
  const key = `${t.kanji}|${t.furigana || ''}`;
  termLookup.set(key, id);
  // Also index just kanji if single reading
  if (!termLookup.has(`${t.kanji}|`)) {
    termLookup.set(`${t.kanji}|`, id);
  }
}

let newTermsAdded = 0;
let questionsMapped = 0;

for (const q of kData.questions) {
  // Question prompt kotoba
  const qTerms = q.questionKotoba?.kotobaU || [];
  const qTrans = q.questionKotoba?.kotobaV || [];
  const promptTermIds = [];

  for (let i = 0; i < qTerms.length; i++) {
    const rawU = qTerms[i] || '';
    const rawV = qTrans[i] || '';
    const m = rawU.match(/^(.*?)[（\(](.*?)[）\)]$/);
    const kanji = m ? m[1].trim() : rawU.trim();
    const furigana = m ? m[2].trim() : '';
    const artiMatch = rawV.split(/\s*:\s*/);
    const arti = artiMatch.length > 1 ? artiMatch.slice(1).join(' : ').trim() : 'istilah konstruksi';

    const key = `${kanji}|${furigana}`;
    let termId = termLookup.get(key) || termLookup.get(`${kanji}|`);
    if (!termId) {
      const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
      termId = `kb-konst-${hash}`;
      dict.terms[termId] = {
        id: termId,
        kanji,
        furigana,
        arti,
        unitType: 'construction_term',
        field: 'KONSTRUKSI',
        status: 'verified'
      };
      termLookup.set(key, termId);
      newTermsAdded++;
    }
    if (!promptTermIds.includes(termId)) promptTermIds.push(termId);
  }

  map.questions[q.id] = promptTermIds;
  if (!map.options[q.id]) map.options[q.id] = {};

  // Options kotoba (A, B, C, D)
  for (const opt of q.options) {
    const optLetter = opt.id;
    const optKotobaObj = q.optionsKotoba?.[optLetter];
    const optTerms = optKotobaObj?.kotobaU || opt.kotobaU || [];
    const optTransList = optKotobaObj?.kotobaV || opt.kotobaV || [];
    const optTermIds = [];

    for (let i = 0; i < optTerms.length; i++) {
      const rawU = optTerms[i] || '';
      const rawV = optTransList[i] || '';
      const m = rawU.match(/^(.*?)[（\(](.*?)[）\)]$/);
      const kanji = m ? m[1].trim() : rawU.trim();
      const furigana = m ? m[2].trim() : '';
      const artiMatch = rawV.split(/\s*:\s*/);
      const arti = artiMatch.length > 1 ? artiMatch.slice(1).join(' : ').trim() : 'istilah konstruksi';

      const key = `${kanji}|${furigana}`;
      let termId = termLookup.get(key) || termLookup.get(`${kanji}|`);
      if (!termId) {
        const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
        termId = `kb-konst-${hash}`;
        dict.terms[termId] = {
          id: termId,
          kanji,
          furigana,
          arti,
          unitType: 'construction_term',
          field: 'KONSTRUKSI',
          status: 'verified'
        };
        termLookup.set(key, termId);
        newTermsAdded++;
      }
      if (!optTermIds.includes(termId)) optTermIds.push(termId);
    }

    map.options[q.id][optLetter] = optTermIds;
    if (map.byCompositeKey) {
      map.byCompositeKey[`${q.id}::${optLetter}`] = optTermIds;
    }
  }

  questionsMapped++;
}

fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n', 'utf8');
fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n', 'utf8');

console.log(`Kotoba integration complete: Added ${newTermsAdded} new terms to sharedKotobaDictionary (total: ${Object.keys(dict.terms).length}).`);
console.log(`Mapped ${questionsMapped} questions into kotobaMapping (total questions: ${Object.keys(map.questions).length}).`);
