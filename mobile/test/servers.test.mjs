// The phone app's connection logic: addresses, QR codes and links, the saved list, and checking a server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAddress, addressFromLink, explainFailure, checkServer, ServerList } from '../www/servers.js';

test('typed addresses are tidied up', () => {
  assert.equal(normaliseAddress('192.168.1.20:8484'), 'http://192.168.1.20:8484');
  assert.equal(normaliseAddress('  http://hearth.local:8484/ '), 'http://hearth.local:8484');
  assert.equal(normaliseAddress('https://money.example.com/#/plan'), 'https://money.example.com');
  assert.equal(normaliseAddress('http://192.168.1.20:8484/index.html'), 'http://192.168.1.20:8484');
  assert.equal(normaliseAddress('https://example.com/hearth/'), 'https://example.com/hearth', 'a reverse-proxy path is kept');
  assert.equal(normaliseAddress(''), '');
  assert.equal(normaliseAddress('http://'), '');
});

test('QR codes and links from Phones & devices are understood', () => {
  assert.equal(addressFromLink('hearth://connect?url=http%3A%2F%2F192.168.1.20%3A8484'), 'http://192.168.1.20:8484');
  assert.equal(addressFromLink('http://192.168.1.20:8484'), 'http://192.168.1.20:8484', 'the "browser" QR code works too');
  assert.equal(addressFromLink('hearth://connect'), '');
  assert.equal(addressFromLink('WIFI:S:home;T:WPA;P:secret;;'), '', 'other QR codes are ignored');
});

test('problems are explained in plain words', () => {
  assert.match(explainFailure(new Error('Timed out'), 'http://10.0.0.2:8484'), /same Wi-Fi/);
  assert.match(explainFailure(new Error('Not a Hearth server'), 'http://10.0.0.2:80'), /port number/);
  assert.match(explainFailure(new TypeError('Load failed'), 'http://homeassistant.local:8123'), /Home Assistant itself/);
});

test('checkServer recognises Hearth and nothing else', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ needsSetup: false, version: '1.6.0' }) });
  assert.deepEqual(await checkServer('http://h', { fetchImpl: ok }), { version: '1.6.0', needsSetup: false });
  const notHearth = async () => ({ ok: true, json: async () => ({ hello: 'world' }) });
  await assert.rejects(checkServer('http://h', { fetchImpl: notHearth }), /Not a Hearth/);
  const slow = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(checkServer('http://h', { fetchImpl: slow, timeoutMs: 50 }), /Timed out/);
});

test('saved servers: newest first, no duplicates, removable', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const list = new ServerList(storage);
  assert.equal(list.last(), null);
  list.remember('http://a:8484'); list.remember('http://b:8484'); list.remember('http://a:8484');
  assert.deepEqual(list.all().map((s) => s.url), ['http://a:8484', 'http://b:8484']);
  assert.equal(list.last().name, 'a:8484');
  list.forget('http://a:8484');
  assert.equal(list.last().url, 'http://b:8484');
  mem.set('hearth.servers', 'not json');
  assert.deepEqual(list.all(), [], 'a damaged list starts again instead of crashing');
});
