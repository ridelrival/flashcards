import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const source = readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker() {
  const listeners = {}, deleted = [], cached = [], saved = [], scope = 'https://example.test/flashcards/';
  let waiting = 0;
  const context = {URL,Set,Promise,fetch:async () => { throw new Error('offline'); },self:{registration:{scope},clients:{claim:async () => {}},skipWaiting:() => { waiting++; },addEventListener:(name,fn) => { listeners[name] = fn; }},caches:{keys:async () => [`flashcards:${scope}:v3`,'another-app','flashcard-v3',`flashcards:${scope}:v4`],delete:async name => { deleted.push(name); },open:async () => ({addAll:async files => cached.push(...files),match:async url => ({url,cached:true}),put:async (...args) => saved.push(args)})}};
  vm.runInNewContext(source,context);
  return {listeners,deleted,cached,saved,get waiting() { return waiting; }};
}
test('install caches every real app asset and waits for explicit update approval',async () => {
  const w = worker(); let promise;
  w.listeners.install({waitUntil:p => { promise = p; }}); await promise;
  assert.equal(w.waiting,0);
  for (const path of w.cached) assert.ok(existsSync(new URL(`../${path === './' ? 'index.html' : path}`,import.meta.url)),path);
  assert.ok(w.cached.includes('./js/storage.js')); assert.ok(w.cached.includes('./icon.png'));
  w.listeners.message({data:{type:'SKIP_WAITING'}}); assert.equal(w.waiting,1);
});
test('activation only removes caches owned by this app scope',async () => {
  const w = worker(); let promise;
  w.listeners.activate({waitUntil:p => { promise = p; }}); await promise;
  assert.deepEqual(w.deleted,['flashcards:https://example.test/flashcards/:v3','flashcards:https://example.test/flashcards/:v4']);
});
test('offline shell comes from installed cache and other traffic is untouched',async () => {
  const w = worker(); let response;
  w.listeners.fetch({request:{method:'GET',url:'https://example.test/flashcards/?q=1'},respondWith:p => { response = p; }});
  assert.equal((await response).cached,true);
  assert.equal((await response).url,'https://example.test/flashcards/');
  for (const [method,url] of [['POST','https://example.test/flashcards/'],['GET','https://other.test/flashcards/'],['GET','https://example.test/another-app/'],['GET','https://example.test/flashcards/tests/storage.html']]) {
    let intercepted = false;
    w.listeners.fetch({request:{method,url},respondWith:() => { intercepted = true; }});
    assert.equal(intercepted,false);
  }
});
