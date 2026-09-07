import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, createCard, migrateLegacy, readLegacy, validateState, toggleSessionShuffle, startSession, reviewCard, undoReview, exportCSV, previewCSV, importCSV, exportBackup, parseBackup, dueCards, localDay, DAY} from '../js/core.js';

const fields = {front:'勉強する',reading:'べんきょうする',furigana:'べん きょう',meaningEn:'study, "learn"\nsecond line',meaningId:'belajar\nbaris kedua'};
function fixture(count = 3) {
  const state = emptyState();
  state.sections = [{id:'s_1',name:'Japanese'},{id:'s_2',name:'Other'}];
  state.decks = [{id:'d_1',sectionId:'s_1',name:'N2'},{id:'d_2',sectionId:'s_2',name:'N2'}];
  for (let i = 0; i < count; i++) { const c = createCard('d_1',{...fields,front:`単語${i}`}); state.cards[c.id] = c; }
  return state;
}
test('shuffle preserves displayed card and answered prefix on both toggle directions',() => {
  const s = {queue:['b','d','a','c'],order:['a','b','c','d'],index:1,shuffled:true};
  const off = toggleSessionShuffle(s);
  assert.deepEqual(off.queue,['b','d','a','c']);
  const on = toggleSessionShuffle(off,() => 0);
  assert.deepEqual(on.queue,['b','d','c','a']);
  assert.equal(on.queue[on.index],'d');
  assert.deepEqual(s.queue,['b','d','a','c']);
  assert.deepEqual(toggleSessionShuffle({...s,index:3}).queue,s.queue);
});
test('a session started shuffled can restore natural remaining order',() => {
  const state = fixture(5), original = Object.keys(state.cards);
  const session = startSession(state,{type:'deck',id:'d_1'},{shuffle:true,random:() => 0});
  const restored = toggleSessionShuffle(session);
  assert.equal(restored.queue[0],session.queue[0]);
  assert.deepEqual(restored.queue.slice(1),original.filter(key => key !== session.queue[0]));
});
test('CSV roundtrip preserves multiline, quoted, comma, Unicode, and both sections',() => {
  const state = fixture(1), c = createCard('d_2',fields); state.cards[c.id] = c;
  const preview = previewCSV(exportCSV(state));
  assert.equal(preview.cards,2); assert.equal(preview.sections,2);
  assert.equal(preview.records[1].meaningEn,fields.meaningEn);
  assert.equal(preview.records[1].meaningId,fields.meaningId);
  const restored = importCSV(emptyState(),preview).state;
  assert.equal(restored.sections.length,2);
  assert.equal(restored.decks.length,2);
  assert.equal(Object.values(restored.cards)[1].front,fields.front);
});
test('legacy CSV column labels and order are mapped without positional guesses',() => {
  const p = previewCSV('Section,Deck Name,Front,Furigana,Reading,Meaning EN,Meaning ID\r\n日本語,N5,猫,ねこ,ねこ,cat,kucing');
  assert.equal(p.records[0].sectionName,'日本語');
  assert.equal(p.records[0].reading,'ねこ');
  assert.equal(p.records[0].meaningId,'kucing');
});
test('malformed imports are rejected instead of partially imported',() => {
  assert.throws(() => previewCSV('front,meaningEn\na,"unfinished'),/unclosed quote/);
  assert.throws(() => previewCSV('front,meaningEn\na,b,c'),/fields/);
  assert.throws(() => previewCSV('x,y\na,b'),/column/);
  assert.throws(() => previewCSV('front,front,meaningEn\na,b,c'),/duplicate/);
});
test('repeat CSV import creates fresh decks without overwriting existing content',() => {
  const p = previewCSV('sectionName,deckName,front,meaningId\nJapanese,N2,猫,kucing');
  const first = importCSV(emptyState(),p).state;
  const second = importCSV(first,p).state;
  assert.deepEqual(second.decks.map(d => d.name),['N2','N2 (2)']);
  assert.equal(Object.keys(second.cards).length,2);
  assert.equal(Object.keys(first.cards).length,1);
});
test('CSV prototype-like names are data, not object keys',() => {
  const p = previewCSV('sectionName,deckName,front,meaningEn\n__proto__,constructor,<img onerror=x>,safe');
  const state = importCSV(emptyState(),p).state;
  assert.equal(state.sections[0].name,'__proto__');
  assert.equal(state.decks[0].name,'constructor');
  assert.equal(Object.values(state.cards)[0].front,'<img onerror=x>');
  assert.doesNotThrow(() => validateState(state));
});
test('migration preserves duplicates, edited subdeck content, and legacy meanings',() => {
  const old = {front:'猫',reading:'ねこ',meaning:'cat'};
  const state = migrateLegacy([[{id:'s_1',name:'日本語'}],[{id:'d_1',sectionId:'s_1',name:'N5'}],{d_1:[old,old]},{d_1:[old,{...old,meaning:'feline'}]},{d_1:[old]}]);
  const cards = Object.values(state.cards);
  assert.equal(cards.length,3);
  assert.equal(cards.filter(c => c.progress.status === 'skipped').length,2);
  assert.equal(cards.find(c => c.meaningEn === 'feline').progress.status,'skipped');
  assert.equal(new Set(cards.map(c => c.id)).size,3);
});
test('corrupt or orphaned legacy storage stops migration without resetting',() => {
  assert.throws(() => readLegacy({getItem: () => '{bad'}),/Cannot read/);
  assert.throws(() => readLegacy({getItem: () => 'null'}),/Invalid legacy/);
  assert.throws(() => migrateLegacy([[],[],{missing:[fields]},{},{}]),/missing deck/);
});
test('daily scheduling, canonical statuses, and undo restore the complete prior answer',() => {
  let state = fixture(1); const now = new Date(2026,8,6,23,59).getTime();
  state.session = startSession(state,{type:'deck',id:'d_1'},{now});
  const key = state.session.queue[0], before = structuredClone(state);
  const skipped = reviewCard(state,'skip',now);
  assert.equal(skipped.cards[key].progress.status,'skipped');
  assert.equal(skipped.cards[key].progress.dueAt,now+600000);
  assert.equal(skipped.daily[localDay(now)],1);
  const undone = undoReview(skipped);
  assert.deepEqual(undone.cards,before.cards);
  assert.equal(undone.session.index,0); assert.equal(undone.daily[localDay(now)],0);
  const got = reviewCard(undone,'got',now);
  assert.equal(got.cards[key].progress.status,'gotIt');
  assert.equal(got.cards[key].progress.dueAt,now+DAY);
  assert.equal(Object.keys(got.cards).length,1);
  assert.throws(() => reviewCard(got,'got',now),/complete/);
});
test('study session respects category, due time, limit and search normalization',() => {
  const state = fixture(60), keys = Object.keys(state.cards), now = 1000000;
  state.cards[keys[0]].progress.dueAt = now+DAY;
  state.cards[keys[1]].front = 'ＡＢＣ';
  assert.equal(dueCards(state,{type:'deck',id:'d_1'},{query:'abc'}).length,1);
  const session = startSession(state,{type:'deck',id:'d_1'},{now});
  assert.equal(session.queue.length,20); assert.equal(session.queue.includes(keys[0]),false);
  assert.throws(() => startSession(state,{type:'deck',id:'d_1'},{category:'gotIt',now}),/No cards/);
});
test('JSON backup restores IDs, progress, preferences, empty decks and saved session',() => {
  let state = fixture(); state.settings.direction = 'id-jp';
  state.session = startSession(state,{type:'section',id:'s_1'},{now:100});
  state = reviewCard(state,'got',100);
  const restored = parseBackup(exportBackup(state));
  assert.deepEqual(restored.cards,state.cards); assert.deepEqual(restored.decks,state.decks);
  assert.deepEqual(restored.settings,state.settings); assert.deepEqual(restored.daily,state.daily);
  assert.deepEqual(restored.session.queue,state.session.queue); assert.equal(restored.session.index,1);
  assert.equal(restored.session.undo,null);
});
test('backup validation rejects missing deck references, invalid scheduling and future schemas',() => {
  const state = fixture(1), key = Object.keys(state.cards)[0];
  assert.throws(() => validateState({...state,schemaVersion:99}),/version/);
  assert.throws(() => validateState({...state,decks:[]}),/missing deck/);
  state.cards[key].progress.dueAt = -1;
  assert.throws(() => validateState(state),/review date/);
});
