import {migrateLegacy, readLegacy, validateState} from './core.js';

export class FlashcardStore {
  constructor(db) { this.db = db; }
  static async open() {
    if (!globalThis.indexedDB) throw new Error('This browser cannot open local storage. Use a browser with IndexedDB enabled.');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('flashcards-v2', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta', {keyPath: 'key'});
        request.result.createObjectStore('cards', {keyPath: 'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Flashcards tabs, then reload to finish upgrading storage.'));
    });
    db.onversionchange = () => db.close();
    return new FlashcardStore(db);
  }
  async load() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['meta','cards'], 'readonly');
      const meta = tx.objectStore('meta').get('state');
      const cards = tx.objectStore('cards').getAll();
      tx.oncomplete = () => {
        if (!meta.result) { resolve(null); return; }
        try {
          const state = validateState({...meta.result, cards: Object.fromEntries(cards.result.map(c => [c.id,c]))});
          // Undo is intentionally session-local after a reload/import.
          resolve(state);
        } catch (error) { reject(error); }
      };
      tx.onabort = () => reject(tx.error || new Error('Storage read was interrupted.'));
      tx.onerror = () => {};
    });
  }
  async initialize(storage = localStorage) {
    const existing = await this.load();
    if (existing) return existing;
    const migrated = migrateLegacy(readLegacy(storage));
    const revision = await this.save(migrated, {all: true});
    return {...migrated, revision};
  }
  async dumpRaw() {
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction(['meta','cards'],'readonly');
      const meta = tx.objectStore('meta').getAll(), cards = tx.objectStore('cards').getAll();
      tx.oncomplete = () => resolve({meta:meta.result,cards:cards.result});
      tx.onabort = () => reject(tx.error);
    });
  }
  async save(state, {put = [], remove = [], all = false} = {}) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['meta','cards'], 'readwrite');
      const metadata = tx.objectStore('meta'), cardStore = tx.objectStore('cards');
      const previous = metadata.get('state');
      let conflict = false, writeError = null;
      previous.onsuccess = () => {
        if ((previous.result?.revision || 0) !== state.revision) { conflict = true; tx.abort(); return; }
        try {
        const {cards, ...meta} = state;
        metadata.put({...meta, key: 'state', revision: state.revision + 1});
        if (all) { cardStore.clear(); Object.values(cards).forEach(card => cardStore.put(card)); }
        else {
          put.forEach(key => cardStore.put(cards[key]));
          remove.forEach(key => cardStore.delete(key));
        }
        } catch (error) { writeError = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(state.revision + 1);
      tx.onabort = () => reject(conflict ? new Error('Data changed in another tab. Reload before saving; this change was not written.') : writeError || tx.error || new Error('Could not save. Your previous data is still intact. Export a backup and check browser storage.'));
      tx.onerror = () => {};
    });
  }
}
