import {uid, localDay, LEGACY_KEYS, createCard, dueCards, startSession, toggleSessionShuffle, reviewCard, undoReview, exportCSV, previewCSV, importCSV, exportBackup, parseBackup} from './core.js';
import {FlashcardStore} from './storage.js';

const $ = id => document.getElementById(id);
const fmt = number => number.toLocaleString();
const text = (id, value) => { $(id).textContent = value; };
const node = (tag, value, className) => {
  const el = document.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = value;
  if (className) el.className = className;
  return el;
};
const button = (label, action, data = {}, className = '') => {
  const el = node('button', label, className);
  el.type = 'button'; el.dataset.action = action;
  Object.assign(el.dataset, data);
  return el;
};
let state, store, busy = false, view = 'loadingView', sectionId = null, deckId = null;
let category = 'main', page = 0, selecting = false, selected = new Set(), filtered = [];
let activeItem = null, editingCard = null, pendingImport = null, pendingStudy = null;
let flipped = false, furigana = false, lastRatingAt = 0, toastTimer, searchTimer;
let workerRegistration;
const PAGE_SIZE = 50;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flashcards-data-v2') : null;

function report(error) {
  const message = error?.message || String(error);
  text('errorText', message); $('errorNotice').hidden = false;
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    let notice = dialog.querySelector('.dialog-error');
    if (!notice) { notice = node('p', '', 'dialog-error'); notice.setAttribute('role','alert'); dialog.prepend(notice); }
    notice.textContent = message;
  }
  console.error(error);
}
function toast(message) {
  clearTimeout(toastTimer); text('toast', message); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
async function run(action) {
  if (busy) return;
  busy = true; document.body.setAttribute('aria-busy','true');
  try { await action(); } catch (error) { report(error); }
  finally { busy = false; document.body.removeAttribute('aria-busy'); }
}
async function commit(next, changes = {}) {
  const revision = await store.save(next, changes);
  state = {...next, revision};
  channel?.postMessage({revision});
}
function openDialog(id) {
  $(id).querySelector('.dialog-error')?.remove();
  $(id).showModal();
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
function ask(title, message, label = 'Delete') {
  text('confirmTitle',title); text('confirmText',message); text('confirmButton',label);
  const dialog = $('confirmDialog'); dialog.returnValue = 'cancel';
  openDialog('confirmDialog');
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once:true}));
}
function show(next, focus = true) {
  view = next;
  document.querySelectorAll('main > .view').forEach(el => { el.hidden = el.id !== next; });
  if (focus) { $('main').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
}
function scopeName(scope) {
  return (scope.type === 'deck' ? state.decks : state.sections).find(item => item.id === scope.id)?.name || 'Study session';
}
function scopeForDeck() { return {type:'deck',id:deckId}; }
function empty(list, message) { list.append(node('li',message,'empty')); }
function libraryItem(item, kind, detail) {
  const li = node('li',null,'library-item');
  const open = button('',kind,{id:item.id},'library-open');
  open.append(node('span',kind === 'section' ? '▱' : 'あ','library-symbol'));
  const copy = node('span',null,'library-info');
  copy.append(node('span',item.name,'library-name'),node('span',detail,'library-description'));
  open.append(copy,node('span','→'));
  const more = button('⋯','options',{id:item.id,kind},'icon-button');
  more.setAttribute('aria-label',`Options for ${item.name}`);
  li.append(open,more); return li;
}
function renderHome() {
  const cards = Object.values(state.cards), today = state.daily[localDay()] || 0;
  text('todayCount',fmt(today)); text('goalText',`/ ${state.settings.dailyGoal} reviews`);
  $('dailyProgress').max = state.settings.dailyGoal; $('dailyProgress').value = Math.min(today,state.settings.dailyGoal);
  text('dueSummary',`${fmt(cards.filter(c => c.progress.dueAt <= Date.now()).length)} cards ready to review`);
  text('libraryCount',`${fmt(cards.length)} cards · ${state.decks.length} decks`);
  $('resumeHome').hidden = !state.session;
  if (state.session) text('resumeText',`${scopeName(state.session.scope)} · ${state.session.index} of ${state.session.queue.length} reviewed`);
  const list = $('sectionList'); list.replaceChildren();
  state.sections.forEach(section => {
    const decks = state.decks.filter(d => d.sectionId === section.id), ids = new Set(decks.map(d => d.id));
    list.append(libraryItem(section,'section',`${decks.length} decks · ${fmt(cards.filter(c => ids.has(c.deckId)).length)} cards`));
  });
  if (!state.sections.length) empty(list,'Your library starts here. Add a section or import your cards.');
}
function renderSection() {
  const section = state.sections.find(s => s.id === sectionId);
  if (!section) { renderHome(); show('homeView'); return; }
  text('sectionTitle',section.name);
  const decks = state.decks.filter(d => d.sectionId === sectionId);
  text('sectionSummary',`${decks.length} decks · ${fmt(dueCards(state,{type:'section',id:sectionId}).length)} cards`);
  const list = $('deckList'); list.replaceChildren();
  decks.forEach(deck => {
    const cards = dueCards(state,{type:'deck',id:deck.id});
    list.append(libraryItem(deck,'deck',`${fmt(cards.length)} cards · ${fmt(cards.filter(c => c.progress.dueAt <= Date.now()).length)} due`));
  });
  if (!decks.length) empty(list,'No decks yet. Add a deck, then add your first words.');
}
function renderDeck() {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) { renderSection(); show('sectionView'); return; }
  const cards = dueCards(state,scopeForDeck());
  text('deckTitle',deck.name); text('deckSummary',`${fmt(cards.length)} cards`);
  text('deckDue',`${fmt(cards.filter(c => c.progress.dueAt <= Date.now()).length)} cards ready to review`);
  for (const [key,label] of [['main','Main'],['skipped','Skipped'],['gotIt','Got It']]) {
    text(`tab_${key}`,`${label} (${fmt(key === 'main' ? cards.length : cards.filter(c => c.progress.status === key).length)})`);
    $(`tab_${key}`).setAttribute('aria-pressed',String(category === key));
  }
  filtered = dueCards(state,scopeForDeck(),{category,query:$('searchCards').value,dueOnly:$('filterDue').checked});
  page = Math.max(0,Math.min(page,Math.ceil(filtered.length/PAGE_SIZE)-1));
  text('filterSummary',`${fmt(filtered.length)} ${filtered.length === 1 ? 'card' : 'cards'}${$('searchCards').value ? ' found' : ''}`);
  $('selectionBar').hidden = !selecting; $('selectButton').hidden = selecting;
  text('selectedCount',`${selected.size} selected`); $('resetStatus').hidden = category === 'main' || selecting;
  const list = $('cardList'), fragment = document.createDocumentFragment();
  for (const card of filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)) {
    const li = node('li',null,`card-row${selected.has(card.id) ? ' selected' : ''}`);
    if (selecting) {
      const check = node('input'); check.type = 'checkbox'; check.checked = selected.has(card.id); check.dataset.cardSelect = card.id;
      check.setAttribute('aria-label',`Select ${card.front}`); li.append(check);
    }
    const copy = node('div',null,'card-copy'), word = node('div',card.front,'card-word'); word.lang = 'ja';
    if (card.progress.status !== 'main') word.append(node('span',card.progress.status === 'skipped' ? 'Skipped' : 'Got it',`card-status ${card.progress.status}`));
    const reading = node('div',card.reading || '—','card-reading'); reading.lang = 'ja';
    const meanings = node('div',null,'card-meanings');
    for (const [label,value] of [['EN',card.meaningEn],['ID',card.meaningId]]) {
      if (value) { const p = node('p'); p.append(node('span',label,'language-marker'),document.createTextNode(value)); meanings.append(p); }
    }
    copy.append(word,reading,meanings); li.append(copy);
    const more = button('⋯','options',{kind:'card',id:card.id},'icon-button'); more.setAttribute('aria-label',`Options for ${card.front}`); li.append(more); fragment.append(li);
  }
  list.replaceChildren(fragment);
  if (!filtered.length) empty(list,$('searchCards').value || $('filterDue').checked ? 'No matching cards. Try another search or clear Due only.' : 'No cards here yet.');
  $('prevPage').disabled = page === 0; $('nextPage').disabled = (page+1)*PAGE_SIZE >= filtered.length;
  text('pageInfo',`${page+1} / ${Math.max(1,Math.ceil(filtered.length/PAGE_SIZE))}`);
}
function refresh() {
  if (view === 'homeView') renderHome();
  if (view === 'sectionView') renderSection();
  if (view === 'deckView') renderDeck();
}
function goHome() { renderHome(); show('homeView'); }
function goSection(id = sectionId) { sectionId = id; selecting = false; selected.clear(); renderSection(); show('sectionView'); }
function goDeck(id) {
  deckId = id; sectionId = state.decks.find(d => d.id === id)?.sectionId;
  category = 'main'; page = 0; selected.clear(); selecting = false;
  $('searchCards').value = ''; $('filterDue').checked = false;
  renderDeck(); show('deckView');
}
export function renderRuby(target, word, reading, visible = true) {
  target.replaceChildren();
  const parts = reading.trim().split(/\s+/); let index = 0;
  for (const char of word) {
    if (/\p{Script=Han}/u.test(char) && reading.trim()) {
      const ruby = node('ruby'); ruby.append(document.createTextNode(char));
      const rt = node('rt',parts[index++] || ''); rt.hidden = !visible;
      ruby.append(rt); target.append(ruby);
    } else target.append(document.createTextNode(char));
  }
}
function renderStudy() {
  const s = state.session;
  if (!s) { goHome(); return; }
  if (s.index >= s.queue.length) { renderResults(); return; }
  const card = state.cards[s.queue[s.index]];
  flipped = false;
  text('studyProgress',`${s.index+1} / ${s.queue.length}`);
  $('sessionProgress').max = s.queue.length; $('sessionProgress').value = s.index;
  text('studyDeckName',state.decks.find(d => d.id === card.deckId)?.name || '');
  text('studyDirection',s.direction === 'jp-id' ? 'Japanese → meaning' : 'Meaning → Japanese');
  text('questionLabel',s.direction === 'jp-id' ? 'WORD' : 'MEANING');
  $('studyQuestion').classList.toggle('reverse',s.direction === 'id-jp');
  $('studyQuestion').lang = s.direction === 'jp-id' ? 'ja' : card.meaningId ? 'id' : 'en';
  if (s.direction === 'jp-id') renderRuby($('studyQuestion'),card.front,card.furigana,furigana);
  else text('studyQuestion',card.meaningId || card.meaningEn || card.reading || card.front);
  renderRuby($('studyAnswerWord'),card.front,card.furigana,furigana);
  text('studyReading',card.reading || '—'); text('studyMeaningEn',card.meaningEn || '—'); text('studyMeaningId',card.meaningId || '—');
  const interval = card.progress.intervalDays === 0 ? 1 : card.progress.intervalDays < 3 ? 3 : Math.min(card.progress.intervalDays * 2,365);
  text('gotInterval',interval === 1 ? 'Review tomorrow · 2' : `Review in ${interval} days · 2`);
  $('shuffleToggle').setAttribute('aria-pressed',String(s.shuffled)); $('furiganaToggle').setAttribute('aria-pressed',String(furigana));
  $('undoStudy').disabled = !s.undo;
  updateFaces(); show('studyView',view !== 'studyView');
}
function updateFaces() {
  $('questionFace').hidden = flipped; $('answerFace').hidden = !flipped;
  $('studyCard').setAttribute('aria-label',flipped ? 'Show question' : 'Show answer');
  $('studyCard').setAttribute('aria-describedby',flipped ? 'studyAnswerWord studyReading studyMeaningEn studyMeaningId' : 'studyQuestion');
}
function renderResults() {
  const s = state.session;
  text('resultsName',scopeName(s.scope)); text('resultGot',s.got); text('resultSkip',s.skipped);
  text('resultsGoal',`${state.daily[localDay()] || 0} reviews today · Daily goal: ${state.settings.dailyGoal}`);
  $('undoResults').disabled = !s.undo; show('resultsView');
}
function openName(kind, id = null) {
  activeItem = {kind,id};
  text('nameTitle',`${id ? 'Rename' : 'Add'} ${kind}`);
  $('nameInput').value = id ? (kind === 'section' ? state.sections : state.decks).find(item => item.id === id).name : '';
  openDialog('nameDialog'); $('nameInput').focus();
}
function cardFields() {
  return Object.fromEntries([['front','cardFront'],['reading','cardReading'],['furigana','cardFurigana'],['meaningEn','cardMeaningEn'],['meaningId','cardMeaningId']].map(([key,id]) => [key,$(id).value.trim()]));
}
function previewCard() {
  const c = cardFields(); renderRuby($('previewWord'),c.front || 'WORD',c.furigana);
  text('previewMeaning',[c.meaningEn,c.meaningId].filter(Boolean).join('\n') || 'Your meaning appears here');
}
function openCard(id = null) {
  editingCard = id; $('cardForm').reset();
  text('cardTitle',id ? 'Edit card' : 'Add card'); $('saveAnother').hidden = !!id;
  const c = state.cards[id];
  if (c) for (const [key,input] of [['front','cardFront'],['reading','cardReading'],['furigana','cardFurigana'],['meaningEn','cardMeaningEn'],['meaningId','cardMeaningId']]) $(input).value = c[key];
  previewCard(); openDialog('cardDialog'); $('cardFront').focus();
}
function openSettings() {
  for (const key of ['dailyGoal','sessionSize','direction']) $(key).value = state.settings[key];
  openDialog('settingsDialog');
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = node('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
function backup(suffix = '') { download(exportBackup(state),`flashcards-backup-${localDay()}${suffix}.json`,'application/json'); }
async function deleteItems(ids, title) {
  if (!ids.length) return;
  if (!await ask(title,`Delete ${ids.length} card(s) from the library and their learning status? A session containing them will be cleared. Export a backup first if you want a recovery copy.`)) return;
  const cards = {...state.cards}; ids.forEach(id => delete cards[id]);
  const next = {...state,cards,session: state.session?.queue.some(id => ids.includes(id)) ? null : state.session};
  await commit(next,{remove:ids}); selected.clear(); selecting = false; refresh(); toast('Cards deleted.');
}
async function removeItem() {
  const {kind,id} = activeItem; $('optionsDialog').close();
  if (kind === 'card') return deleteItems([id],'Delete this card?');
  const decks = kind === 'deck' ? [id] : state.decks.filter(d => d.sectionId === id).map(d => d.id);
  const ids = Object.values(state.cards).filter(c => decks.includes(c.deckId)).map(c => c.id);
  if (!await ask(`Delete ${kind}?`,`This will delete the ${kind}, ${ids.length} cards, and their progress. Export a backup first if you want a recovery copy.`)) return;
  const cards = {...state.cards}; ids.forEach(id => delete cards[id]);
  const next = {...state,cards,decks:state.decks.filter(d => !decks.includes(d.id)),sections:kind === 'section' ? state.sections.filter(s => s.id !== id) : state.sections,session:null};
  await commit(next,{remove:ids}); refresh(); toast(`${kind === 'section' ? 'Section' : 'Deck'} deleted.`);
}
function studyOptions(scope, shuffle = false) {
  pendingStudy = {scope,category:scope.type === 'section' ? 'main' : category};
  const cards = dueCards(state,scope,{category:pendingStudy.category});
  text('studyOptionsSummary',`${scopeName(scope)} · ${cards.length} cards · ${cards.filter(c => c.progress.dueAt <= Date.now()).length} due`);
  text('sessionLimitText',`Up to ${state.settings.sessionSize} cards. Change session size and direction in Settings.${state.session ? ' Starting will replace your saved session; reviewed progress stays saved.' : ''}`);
  $('studyMode').value = 'due'; $('startShuffled').checked = shuffle;
  openDialog('studyOptionsDialog');
}
async function readImport(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a CSV or JSON file smaller than 25 MB.');
  const source = await file.text();
  const isJSON = /\.json$/i.test(file.name);
  pendingImport = isJSON ? {type:'json',state:parseBackup(source)} : {type:'csv',preview:previewCSV(source,{fallbackSection:state.sections.find(s => s.id === sectionId)?.name || 'Imported',fallbackDeck:file.name.replace(/\.csv$/i,'')})};
  const counts = isJSON ? {sections:pendingImport.state.sections.length,decks:pendingImport.state.decks.length,cards:Object.keys(pendingImport.state.cards).length} : pendingImport.preview;
  text('importTitle',isJSON ? 'Restore full backup' : 'Review CSV import');
  text('importSummary',`${counts.sections} sections · ${counts.decks} decks · ${fmt(counts.cards)} cards`);
  text('importExplanation',isJSON ? 'This replaces the current library, progress, preferences, and saved session. A backup of your current library will download before the replacement is saved.' : 'Section names are preserved. Cards are added in new decks; existing decks and progress stay intact. Repeated imports get a numbered deck name.');
  text('importConfirm',isJSON ? 'Back up & restore' : 'Import cards');
  const rows = isJSON ? Object.values(pendingImport.state.cards).slice(0,5) : pendingImport.preview.records.slice(0,5);
  const table = node('table'), head = node('thead'), heading = node('tr');
  ['Word','English','Indonesia'].forEach(label => heading.append(node('th',label))); head.append(heading); table.append(head);
  const body = node('tbody');
  for (const card of rows) { const tr = node('tr'); [card.front,card.meaningEn,card.meaningId].forEach(value => tr.append(node('td',value))); body.append(tr); }
  table.append(body); $('importPreview').replaceChildren(table); closeDialogs(); openDialog('importDialog');
}
async function applyImport() {
  if (!pendingImport) return;
  if (pendingImport.type === 'json') {
    backup('-before-restore');
    await commit({...pendingImport.state,revision:state.revision},{all:true});
  } else {
    const result = importCSV(state,pendingImport.preview);
    await commit(result.state,{put:result.added});
  }
  pendingImport = null; closeDialogs(); goHome(); toast('Your library is saved.');
}
async function handle(action, el) {
  if (action === 'reload') { location.reload(); return; }
  if (action === 'dismiss-error') { $('errorNotice').hidden = true; return; }
  if (action === 'recovery') {
    const legacy = {};
    for (const key of LEGACY_KEYS) { try { legacy[key] = localStorage.getItem(key); } catch { legacy[key] = 'Storage unavailable'; } }
    download(JSON.stringify({legacy,indexedDB:store ? await store.dumpRaw() : null},null,2),`flashcards-recovery-${localDay()}.json`,'application/json'); return;
  }
  if (!state) return;
  switch (action) {
    case 'home': goHome(); break;
    case 'section': goSection(el.dataset.id || sectionId); break;
    case 'deck': goDeck(el.dataset.id); break;
    case 'settings': openSettings(); break;
    case 'add-section': openName('section'); break;
    case 'add-deck': openName('deck'); break;
    case 'add-card': openCard(); break;
    case 'options': {
      activeItem = {kind:el.dataset.kind,id:el.dataset.id};
      const item = activeItem.kind === 'card' ? state.cards[activeItem.id] : (activeItem.kind === 'deck' ? state.decks : state.sections).find(x => x.id === activeItem.id);
      text('optionsTitle',item.name || item.front); openDialog('optionsDialog'); break;
    }
    case 'edit-item': $('optionsDialog').close(); activeItem.kind === 'card' ? openCard(activeItem.id) : openName(activeItem.kind,activeItem.id); break;
    case 'delete-item': await removeItem(); break;
    case 'category': category = el.dataset.category; page = 0; selected.clear(); renderDeck(); break;
    case 'prev-page': page--; renderDeck(); $('cardList').scrollIntoView({block:'start'}); break;
    case 'next-page': page++; renderDeck(); $('cardList').scrollIntoView({block:'start'}); break;
    case 'selection': selecting = !selecting; selected.clear(); renderDeck(); break;
    case 'select-visible': filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).forEach(c => selected.add(c.id)); renderDeck(); break;
    case 'delete-selected': await deleteItems([...selected],'Delete selected cards?'); break;
    case 'reset-status': {
      const cards = dueCards(state,scopeForDeck(),{category});
      if (!cards.length || !await ask('Reset this status?',`Move ${cards.length} cards back to Main and make them due now? The cards and review history will stay in your library.`,'Reset status')) break;
      const next = {...state,cards:{...state.cards},session:null};
      cards.forEach(c => { next.cards[c.id] = {...c,progress:{...c.progress,status:'main',dueAt:0,intervalDays:0}}; });
      await commit(next,{put:cards.map(c => c.id)}); renderDeck(); break;
    }
    case 'study-section': studyOptions({type:'section',id:sectionId}); break;
    case 'study-deck': studyOptions(scopeForDeck()); break;
    case 'shuffle-deck': studyOptions(scopeForDeck(),true); break;
    case 'resume': furigana = false; renderStudy(); break;
    case 'pause': goHome(); break;
    case 'flip': if (view === 'studyView') { flipped = !flipped; updateFaces(); } break;
    case 'furigana': {
      furigana = !furigana; const wasFlipped = flipped; renderStudy(); flipped = wasFlipped; updateFaces(); break;
    }
    case 'toggle-shuffle': {
      const wasFlipped = flipped;
      await commit({...state,session:toggleSessionShuffle(state.session)}); renderStudy(); flipped = wasFlipped; updateFaces(); break;
    }
    case 'rate': {
      if (view !== 'studyView' || Date.now() - lastRatingAt < 350) break;
      lastRatingAt = Date.now();
      const key = state.session.queue[state.session.index];
      await commit(reviewCard(state,el.dataset.rating),{put:[key]}); renderStudy(); break;
    }
    case 'undo': {
      const key = state.session?.undo?.card.id;
      if (!key) break;
      await commit(undoReview(state),{put:[key]}); renderStudy(); toast('Last answer undone.'); break;
    }
    case 'finish': await commit({...state,session:null}); goHome(); break;
    case 'backup': backup(); toast('Full backup download started.'); break;
    case 'export-csv': download(exportCSV(state),`flashcards-${localDay()}.csv`,'text/csv;charset=utf-8'); break;
    case 'import': $('importFile').click(); break;
    case 'apply-import': await applyImport(); break;
    case 'update': if (workerRegistration?.waiting) workerRegistration.waiting.postMessage({type:'SKIP_WAITING'}); else location.reload(); break;
  }
}

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close && !busy) { $(close.dataset.close).close(); return; }
  const el = event.target.closest('[data-action]');
  if (el && !el.disabled) run(() => handle(el.dataset.action,el));
});
document.addEventListener('keydown',event => {
  if (view !== 'studyView' || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const action = event.code === 'Space' ? 'flip' : event.key === '1' || event.key === '2' ? 'rate' : event.key.toLowerCase() === 'z' ? 'undo' : null;
  if (action) { event.preventDefault(); if (!event.repeat) run(() => handle(action,{dataset:{rating:event.key === '1' ? 'skip' : 'got'}})); }
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); }));
$('nameForm').addEventListener('submit',event => {
  event.preventDefault(); run(async () => {
    const name = $('nameInput').value.trim(); if (!name) throw new Error('Please enter a name.');
    const key = activeItem.kind === 'section' ? 'sections' : 'decks';
    const list = activeItem.id ? state[key].map(item => item.id === activeItem.id ? {...item,name} : item) : [...state[key],{id:uid(activeItem.kind === 'section' ? 's' : 'd'),name,...(key === 'decks' ? {sectionId} : {})}];
    await commit({...state,[key]:list}); $('nameDialog').close(); refresh(); toast('Saved.');
  });
});
$('cardForm').addEventListener('input',previewCard);
$('cardForm').addEventListener('submit',event => {
  event.preventDefault(); const another = event.submitter?.dataset.another === 'true';
  run(async () => {
    const fields = cardFields(); if (!fields.front || (!fields.meaningEn && !fields.meaningId)) throw new Error('Add a word and at least one meaning.');
    const card = editingCard ? {...state.cards[editingCard],...fields} : createCard(deckId,fields);
    const session = state.session ? {...state.session,undo:null} : null;
    await commit({...state,cards:{...state.cards,[card.id]:card},session},{put:[card.id]}); refresh();
    if (another) { editingCard = null; $('cardForm').reset(); previewCard(); $('cardFront').focus(); }
    else $('cardDialog').close(); toast('Card saved.');
  });
});
$('settingsForm').addEventListener('submit',event => {
  event.preventDefault(); run(async () => {
    const settings = {dailyGoal:Number($('dailyGoal').value),sessionSize:Number($('sessionSize').value),direction:$('direction').value};
    if (!Number.isInteger(settings.dailyGoal) || settings.dailyGoal < 1 || settings.dailyGoal > 1000) throw new Error('Choose a daily goal between 1 and 1,000.');
    await commit({...state,settings}); $('settingsDialog').close(); refresh(); toast('Preferences saved.');
  });
});
$('studyOptionsForm').addEventListener('submit',event => {
  event.preventDefault(); run(async () => {
    const session = startSession(state,pendingStudy.scope,{category:pendingStudy.category,dueOnly:$('studyMode').value === 'due',shuffle:$('startShuffled').checked});
    await commit({...state,session}); $('studyOptionsDialog').close(); furigana = false; renderStudy();
  });
});
$('searchCards').addEventListener('input',() => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; renderDeck(); },120); });
$('filterDue').addEventListener('change',() => { page = 0; renderDeck(); });
$('cardList').addEventListener('change',event => { const id = event.target.dataset.cardSelect; if (id) { event.target.checked ? selected.add(id) : selected.delete(id); text('selectedCount',`${selected.size} selected`); event.target.closest('li').classList.toggle('selected',event.target.checked); } });
$('importFile').addEventListener('change',event => { const file = event.target.files[0]; event.target.value = ''; run(() => readImport(file)); });
channel?.addEventListener('message',event => { if (state && event.data.revision > state.revision) $('externalNotice').hidden = false; });
function connectionStatus() { text('connection',navigator.onLine ? '' : 'Offline · saved on this device'); }
window.addEventListener('online',connectionStatus); window.addEventListener('offline',connectionStatus); connectionStatus();
document.addEventListener('visibilitychange',() => { if (!document.hidden && state && !busy) refresh(); });

async function initWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    workerRegistration = await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    if (workerRegistration.waiting) $('updateNotice').hidden = false;
    workerRegistration.addEventListener('updatefound',() => {
      const worker = workerRegistration.installing;
      worker?.addEventListener('statechange',() => { if (worker.state === 'installed' && navigator.serviceWorker.controller) $('updateNotice').hidden = false; });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange',() => {
      // Reload only for an update that was explicitly offered, not first install.
      if (!$('updateNotice').hidden && !reloading) { reloading = true; location.reload(); }
    });
  } catch { toast('Offline setup could not finish. Reopen the app online to retry.'); }
}
try {
  store = await FlashcardStore.open(); state = await store.initialize(); goHome();
  await initWorker();
} catch (error) {
  text('recoveryText',error.message || 'Browser storage could not be opened.'); show('recoveryView');
}
