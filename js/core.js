export const SCHEMA_VERSION = 2;
export const DAY = 86400000;
export const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
export const localDay = (time = Date.now()) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const emptyProgress = () => ({status: 'main', dueAt: 0, intervalDays: 0, reviews: 0, lapses: 0, lastReviewed: 0});
export const emptyState = () => ({schemaVersion: SCHEMA_VERSION, revision: 0, sections: [], decks: [], cards: {}, settings: {dailyGoal: 20, sessionSize: 20, direction: 'jp-id'}, daily: {}, session: null});
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, label, required = false) => {
  if (typeof value !== 'string' || value.length > 20000 || (required && !value.trim())) fail(`Invalid ${label}.`);
  return value;
};
const id = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail(`Invalid ${label} ID.`);
  return value;
};
const number = (value, label, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`Invalid ${label}.`);
  return value;
};
function content(card) {
  if (!object(card)) fail('Invalid card.');
  return {front: string(card.front, 'word', true), reading: string(card.reading ?? '', 'reading'), furigana: string(card.furigana ?? '', 'furigana'), meaningEn: string(card.meaningEn || card.meaning || '', 'English meaning'), meaningId: string(card.meaningId ?? '', 'Indonesian meaning')};
}
function progress(value) {
  if (!object(value) || !['main', 'skipped', 'gotIt'].includes(value.status)) fail('Invalid card progress.');
  return {status: value.status, dueAt: number(value.dueAt, 'review date'), intervalDays: number(value.intervalDays, 'interval', 36500), reviews: number(value.reviews, 'review count'), lapses: number(value.lapses, 'lapses'), lastReviewed: number(value.lastReviewed, 'last review')};
}
export function validateState(input) {
  if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) fail('Unsupported backup version. Your current data has not been changed.');
  if (!Array.isArray(input.sections) || !Array.isArray(input.decks) || !object(input.cards)) fail('Invalid backup structure.');
  if (input.sections.length > 10000 || input.decks.length > 10000 || Object.keys(input.cards).length > 100000) fail('Backup exceeds supported size.');
  const state = emptyState();
  const sectionIds = new Set(), deckIds = new Set();
  state.sections = input.sections.map(s => {
    if (!object(s)) fail('Invalid section.');
    const key = id(s.id, 'section');
    if (sectionIds.has(key)) fail('Duplicate section ID.');
    sectionIds.add(key);
    return {id: key, name: string(s.name, 'section name', true)};
  });
  state.decks = input.decks.map(d => {
    if (!object(d)) fail('Invalid deck.');
    const key = id(d.id, 'deck');
    if (deckIds.has(key) || !sectionIds.has(d.sectionId)) fail('Deck has a duplicate ID or missing section.');
    deckIds.add(key);
    return {id: key, sectionId: d.sectionId, name: string(d.name, 'deck name', true)};
  });
  for (const [key, c] of Object.entries(input.cards)) {
    if (!object(c) || id(c.id, 'card') !== key || !deckIds.has(c.deckId)) fail('Card has an invalid ID or missing deck.');
    state.cards[key] = {id: key, deckId: c.deckId, ...content(c), progress: progress(c.progress)};
  }
  if (input.settings !== undefined) {
    if (!object(input.settings)) fail('Invalid study settings.');
    const {dailyGoal, sessionSize, direction} = input.settings;
    if (!['jp-id', 'id-jp'].includes(direction) || ![10,20,50,100].includes(sessionSize) || dailyGoal < 1) fail('Invalid study settings.');
    state.settings = {dailyGoal: number(dailyGoal, 'daily goal', 1000), sessionSize, direction};
  }
  if (input.daily !== undefined) {
    if (!object(input.daily)) fail('Invalid daily history.');
    for (const [day, count] of Object.entries(input.daily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('Invalid history date.');
      state.daily[day] = number(count, 'daily review count');
    }
  }
  if (input.session) {
    const s = input.session;
    if (!object(s) || !Array.isArray(s.queue) || !Array.isArray(s.order) || s.queue.length > 100 || !s.queue.every(key => Object.hasOwn(state.cards, key)) || new Set(s.queue).size !== s.queue.length || s.order.length !== s.queue.length || new Set(s.order).size !== s.order.length || !s.order.every(key => s.queue.includes(key))) fail('Invalid saved study session.');
    if (!object(s.scope) || !['deck','section'].includes(s.scope.type) || !(s.scope.type === 'deck' ? deckIds : sectionIds).has(s.scope.id) || !['jp-id','id-jp'].includes(s.direction)) fail('Invalid study session scope.');
    state.session = {queue: [...s.queue], order: [...s.order], index: number(s.index, 'session position', s.queue.length), scope: {...s.scope}, direction: s.direction, shuffled: Boolean(s.shuffled), got: number(s.got, 'session score', s.queue.length), skipped: number(s.skipped, 'session score', s.queue.length), startedAt: number(s.startedAt, 'session date'), undo: null};
    if (state.session.got + state.session.skipped !== state.session.index) fail('Invalid session totals.');
  }
  state.revision = number(input.revision ?? 0, 'revision');
  return state;
}

// Legacy keys are left untouched after a successful migration, as a recovery copy.
export const LEGACY_KEYS = ['flashcard_sections','flashcard_decks','flashcard_cards','flashcard_skipped','flashcard_gotit'];
export function readLegacy(storage) {
  return LEGACY_KEYS.map((key, i) => {
    const raw = storage.getItem(key);
    if (raw === null) return i < 2 ? [] : {};
    let parsed;
    try { parsed = JSON.parse(raw); } catch { fail(`Cannot read ${key}. Export the recovery file before changing this browser's data.`); }
    if (i < 2 ? !Array.isArray(parsed) : !object(parsed)) fail(`Invalid legacy data in ${key}. Migration stopped to protect your cards.`);
    return parsed;
  });
}
export function migrateLegacy([sections, decks, main, skipped, got]) {
  const state = emptyState();
  state.sections = sections;
  state.decks = decks;
  // Validate all references first; never silently discard orphaned data.
  const deckIds = new Set(decks.map(d => d.id));
  for (const group of [main, skipped, got]) {
    for (const [key, values] of Object.entries(group)) {
      if (!Array.isArray(values) || (!deckIds.has(key) && values.length)) fail('Legacy cards reference a missing deck. Export a recovery file to repair it.');
    }
  }
  for (const deck of decks) {
    const matches = new Map();
    for (const [group, status] of [[main, 'main'], [got, 'gotIt'], [skipped, 'skipped']]) {
      for (const old of group[deck.id] || []) {
        const fields = content(old), signature = JSON.stringify(fields);
        let card = status === 'main' ? null : state.cards[matches.get(signature)];
        if (!card) {
          card = {id: uid('c'), deckId: deck.id, ...fields, progress: emptyProgress()};
          state.cards[card.id] = card;
          if (!matches.has(signature)) matches.set(signature, card.id);
        }
        // Old apps allow both statuses; prioritize reviewing a skipped card.
        if (status !== 'main') card.progress.status = status;
      }
    }
  }
  return validateState(state);
}
export function createCard(deckId, fields) {
  return {id: uid('c'), deckId, ...content(fields), progress: emptyProgress()};
}
export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function toggleSessionShuffle(session, random = Math.random) {
  const next = {...session, shuffled: !session.shuffled};
  // The displayed card and answered prefix must never move.
  const pending = session.queue.slice(session.index + 1);
  const ordered = next.shuffled ? shuffled(pending, random) : session.order.filter(key => pending.includes(key));
  next.queue = [...session.queue.slice(0, session.index + 1), ...ordered];
  return next;
}
export function dueCards(state, scope, {category = 'main', dueOnly = false, query = '', now = Date.now()} = {}) {
  const deckIds = new Set(scope.type === 'deck' ? [scope.id] : state.decks.filter(d => d.sectionId === scope.id).map(d => d.id));
  const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
  return Object.values(state.cards).filter(c => deckIds.has(c.deckId) && (category === 'main' || c.progress.status === category) && (!dueOnly || c.progress.dueAt <= now) && (!needle || [c.front,c.reading,c.meaningEn,c.meaningId].some(t => t.normalize('NFKC').toLocaleLowerCase().includes(needle))));
}
export function startSession(state, scope, {category = 'main', dueOnly = true, shuffle = false, now = Date.now(), random = Math.random} = {}) {
  let candidates = dueCards(state, scope, {category, dueOnly, now});
  candidates.sort((a,b) => a.progress.dueAt - b.progress.dueAt);
  const naturalOrder = candidates.map(c => c.id);
  if (shuffle) candidates = shuffled(candidates, random);
  const queue = candidates.slice(0, state.settings.sessionSize).map(c => c.id);
  const selected = new Set(queue), order = naturalOrder.filter(key => selected.has(key));
  if (!queue.length) fail(dueOnly ? 'No cards are due. Choose All cards to practice now.' : 'No cards to study yet.');
  return {queue, order, index: 0, scope: {...scope}, direction: state.settings.direction, shuffled: shuffle, got: 0, skipped: 0, startedAt: now, undo: null};
}
export function reviewCard(state, rating, now = Date.now()) {
  if (!['skip', 'got'].includes(rating)) fail('Invalid rating.');
  const session = state.session, card = state.cards[session?.queue[session.index]];
  if (!card) fail('This session is complete.');
  const p = card.progress;
  const intervalDays = rating === 'skip' ? 0 : p.intervalDays === 0 ? 1 : Math.min(p.intervalDays < 3 ? 3 : p.intervalDays * 2, 365);
  const changed = {...card, progress: {status: rating === 'skip' ? 'skipped' : 'gotIt', intervalDays, dueAt: now + (rating === 'skip' ? 10 * 60000 : intervalDays * DAY), reviews: p.reviews + 1, lapses: p.lapses + (rating === 'skip' ? 1 : 0), lastReviewed: now}};
  const day = localDay(now);
  const undo = {card: structuredClone(card), index: session.index, got: session.got, skipped: session.skipped, day, dailyBefore: state.daily[day] || 0};
  return {...state, cards: {...state.cards, [card.id]: changed}, daily: {...state.daily, [day]: (state.daily[day] || 0) + 1}, session: {...session, index: session.index + 1, got: session.got + (rating === 'got' ? 1 : 0), skipped: session.skipped + (rating === 'skip' ? 1 : 0), undo}};
}
export function undoReview(state) {
  const u = state.session?.undo;
  if (!u || !state.cards[u.card.id]) fail('There is no answer to undo.');
  return {...state, cards: {...state.cards, [u.card.id]: u.card}, daily: {...state.daily, [u.day]: u.dailyBefore}, session: {...state.session, index: u.index, got: u.got, skipped: u.skipped, undo: null}};
}

// Parse records, not lines: quoted CSV fields can contain newlines and commas.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
      }
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (closed) { if (!/\s/.test(c)) fail('Unexpected text after a quoted CSV field.'); }
    else if (c === '"') fail('Unexpected quote in CSV.');
    else field += c;
  }
  if (quoted) fail('CSV has an unclosed quote. Nothing has been imported.');
  row.push(field);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
const HEADER = ['sectionName','deckName','front','reading','furigana','meaningEn','meaningId'];
export function exportCSV(state) {
  const sectionNames = new Map(state.sections.map(s => [s.id, s.name]));
  const decks = new Map(state.decks.map(d => [d.id, d]));
  const rows = [HEADER];
  for (const c of Object.values(state.cards)) {
    const d = decks.get(c.deckId);
    rows.push([sectionNames.get(d.sectionId),d.name,c.front,c.reading,c.furigana,c.meaningEn,c.meaningId]);
  }
  return '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}
export function previewCSV(text, {fallbackSection = 'Imported', fallbackDeck = 'Imported Deck'} = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) fail('CSV must include column headers and at least one card.');
  const headers = rows.shift().map(h => h.toLowerCase().replace(/[\s_-]+/g, ''));
  const aliases = {sectionName: ['sectionname','section'], deckName: ['deckname','deck'], front: ['front','word'], reading: ['reading'], furigana: ['furigana'], meaningEn: ['meaningen','meaningenglish','meaning'], meaningId: ['meaningid','meaningindonesia','meaningindonesian']};
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(h => names.includes(h))]));
  if (indexes.front < 0 || (indexes.meaningEn < 0 && indexes.meaningId < 0)) fail('CSV needs a front/word column and a meaningEn, meaningId, or meaning column.');
  if (new Set(headers).size !== headers.length) fail('CSV contains duplicate column names.');
  const records = rows.map((row, index) => {
    if (row.length !== headers.length) fail(`CSV record ${index + 2} has ${row.length} fields; expected ${headers.length}.`);
    const get = key => indexes[key] < 0 ? '' : row[indexes[key]];
    const c = content({front: get('front'), reading: get('reading'), furigana: get('furigana'), meaningEn: get('meaningEn'), meaningId: get('meaningId')});
    return {sectionName: get('sectionName').trim() || fallbackSection, deckName: get('deckName').trim() || fallbackDeck, ...c};
  });
  if (records.length > 100000) fail('CSV is too large.');
  return {records, cards: records.length, sections: new Set(records.map(r => r.sectionName)).size, decks: new Set(records.map(r => JSON.stringify([r.sectionName,r.deckName]))).size};
}
export function importCSV(state, preview) {
  const next = {...state, sections: [...state.sections], decks: [...state.decks], cards: {...state.cards}};
  const sections = new Map(next.sections.map(s => [s.name, s]));
  const createdDecks = new Map(), added = [];
  for (const record of preview.records) {
    let section = sections.get(record.sectionName);
    if (!section) { section = {id: uid('s'), name: record.sectionName}; sections.set(section.name, section); next.sections.push(section); }
    // Always import into fresh decks, so a repeat import cannot overwrite a deck.
    const key = JSON.stringify([section.id, record.deckName]);
    let deck = createdDecks.get(key);
    if (!deck) {
      let name = record.deckName, count = 2;
      while (next.decks.some(d => d.sectionId === section.id && d.name === name)) name = `${record.deckName} (${count++})`;
      deck = {id: uid('d'), sectionId: section.id, name};
      createdDecks.set(key, deck); next.decks.push(deck);
    }
    const card = createCard(deck.id, record);
    next.cards[card.id] = card; added.push(card.id);
  }
  return {state: next, added};
}
export const exportBackup = state => JSON.stringify({format: 'flashcards-backup', exportedAt: new Date().toISOString(), data: {...state, session: state.session ? {...state.session, undo: null} : null}}, null, 2);
export function parseBackup(text) {
  let json;
  try { json = JSON.parse(text); } catch { fail('This file is not valid JSON.'); }
  if (!object(json) || json.format !== 'flashcards-backup') fail('This is not a Flashcards backup.');
  return validateState(json.data);
}
