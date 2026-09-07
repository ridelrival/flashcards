import {FlashcardStore} from '../js/storage.js';
import {emptyState,createCard,startSession,reviewCard,parseBackup,exportBackup} from '../js/core.js';
const assert = (condition,message) => { if (!condition) throw new Error(message); };
const reject = async promise => { try { await promise; } catch { return; } throw new Error('Expected operation to be rejected'); };
const fixture = () => {
  const state = emptyState(); state.sections = [{id:'s_test',name:'Test'}]; state.decks = [{id:'d_test',sectionId:'s_test',name:'Words'}];
  const card = createCard('d_test',{front:'猫',meaningEn:'cat',meaningId:'kucing'}); state.cards[card.id] = card; return state;
};
async function isolated() {
  const name = `flashcards-test-${crypto.randomUUID()}`;
  const db = await new Promise((resolve,reject) => {
    const r = indexedDB.open(name,1);
    r.onupgradeneeded = () => { r.result.createObjectStore('meta',{keyPath:'key'}); r.result.createObjectStore('cards',{keyPath:'id'}); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return {store:new FlashcardStore(db),cleanup:async () => { db.close(); await new Promise((resolve,reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }};
}
const tests = [
  ['Legacy migration is atomic, keeps original keys, and is not repeated',async store => {
    const raw = new Map([['flashcard_sections',JSON.stringify([{id:'s_test',name:'Test'}])],['flashcard_decks',JSON.stringify([{id:'d_test',sectionId:'s_test',name:'Words'}])],['flashcard_cards',JSON.stringify({d_test:[{front:'猫',meaning:'cat'}]})]]);
    const original = [...raw];
    const state = await store.initialize({getItem:key => raw.get(key) ?? null});
    assert(Object.keys(state.cards).length === 1,'card migrated');
    assert(JSON.stringify([...raw]) === JSON.stringify(original),'legacy keys retained');
    const again = await store.initialize({getItem:() => { throw new Error('Should not re-read old keys'); }});
    assert(Object.keys(again.cards)[0] === Object.keys(state.cards)[0],'stable card identity');
  }],
  ['A failed migration writes no replacement records',async store => {
    await reject(store.initialize({getItem:() => '{corrupt'}));
    assert(await store.load() === null,'failed migration leaves database empty');
  }],
  ['Card, daily count and saved session commit and reload together',async store => {
    let state = fixture(); state.revision = await store.save(state,{all:true});
    state.session = startSession(state,{type:'deck',id:'d_test'});
    state = reviewCard(state,'got'); const id = Object.keys(state.cards)[0];
    state.revision = await store.save(state,{put:[id]});
    const loaded = await store.load();
    assert(loaded.cards[id].progress.reviews === 1,'progress persisted');
    assert(loaded.session.index === 1,'session persisted');
    assert(Object.values(loaded.daily)[0] === 1,'daily count persisted');
    assert(loaded.revision === 2,'revision persisted');
  }],
  ['An aborted write rolls back metadata and cards',async store => {
    let state = fixture(); state.revision = await store.save(state,{all:true});
    const bad = createCard('d_test',{front:'bad',meaningEn:'bad'}); bad.uncloneable = () => {};
    const invalid = {...state,sections:[{id:'s_test',name:'Must roll back'}],cards:{...state.cards,[bad.id]:bad}};
    await reject(store.save(invalid,{put:[bad.id]}));
    const loaded = await store.load();
    assert(loaded.sections[0].name === 'Test','metadata rolled back');
    assert(Object.keys(loaded.cards).length === 1,'cards rolled back');
    assert(loaded.revision === 1,'revision rolled back');
  }],
  ['A stale tab cannot overwrite a newer revision',async store => {
    let state = fixture(); state.revision = await store.save(state,{all:true});
    const stale = structuredClone(state);
    state = {...state,settings:{...state.settings,dailyGoal:30}};
    state.revision = await store.save(state);
    await reject(store.save({...stale,settings:{...stale.settings,dailyGoal:99}}));
    assert((await store.load()).settings.dailyGoal === 30,'newer preferences retained');
  }],
  ['Full replacement removes old cards and restores backup preferences',async store => {
    let state = fixture(); state.revision = await store.save(state,{all:true});
    const replacement = fixture(); replacement.settings.dailyGoal = 40;
    const imported = parseBackup(exportBackup(replacement)); imported.revision = state.revision;
    await store.save(imported,{all:true}); const loaded = await store.load();
    assert(Object.keys(loaded.cards).length === 1,'old cards cleared');
    assert(!loaded.cards[Object.keys(state.cards)[0]],'old card absent');
    assert(loaded.settings.dailyGoal === 40,'settings restored');
  }],
  ['Saving one card leaves the other records unchanged',async store => {
    let state = fixture();
    for (let i = 0; i < 3000; i++) { const card = createCard('d_test',{front:`単語${i}`,meaningEn:`word ${i}`}); state.cards[card.id] = card; }
    state.revision = await store.save(state,{all:true});
    const ids = Object.keys(state.cards); state.cards = {...state.cards,[ids[0]]:{...state.cards[ids[0]],meaningEn:'updated'}};
    await store.save(state,{put:[ids[0]]}); const loaded = await store.load();
    assert(Object.keys(loaded.cards).length === 3001,'all records retained');
    assert(loaded.cards[ids[0]].meaningEn === 'updated','target updated');
    assert(loaded.cards[ids[1]].meaningEn === 'word 0','other record unchanged');
  }]
];
document.getElementById('run').addEventListener('click',async () => {
  document.getElementById('run').disabled = true; document.getElementById('results').replaceChildren(); let passed = 0;
  for (const [name,test] of tests) {
    const item = document.createElement('li'), {store,cleanup} = await isolated();
    try { await test(store); passed++; item.textContent = `PASS — ${name}`; }
    catch(error) { item.textContent = `FAIL — ${name}: ${error.message}`; item.className = 'fail'; }
    finally { await cleanup(); }
    document.getElementById('results').append(item);
  }
  document.getElementById('summary').textContent = `${passed}/${tests.length} passed`;
  document.getElementById('run').disabled = false;
});
