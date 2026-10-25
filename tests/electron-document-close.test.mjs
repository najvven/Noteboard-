import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { installDocumentCloseGuard } from '../shared/electron-document-close.js';

function fixture(response = 0, timeoutMs = 1_000) {
  const ipcMain = new EventEmitter(), win = new EventEmitter(), sent = [], prompts = [];
  let destroyed = false;
  let enabled = true;
  win.isEnabled = () => enabled;
  win.setEnabled = value => { enabled = value; };
  win.webContents = { mainFrame: {}, send: (...args) => sent.push(args) };
  win.isDestroyed = () => destroyed;
  win.close = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    win.emit('close', event);
    if (!event.prevented) { destroyed = true; win.emit('closed'); }
  };
  const owner = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  installDocumentCloseGuard(win, { ipcMain, timeoutMs, dialog: { showMessageBox: async (_win, options) => { prompts.push(options); return { response }; } } });
  const register = () => ipcMain.emit('document:close-handler-ready', owner);
  const acknowledge = (saved, event = owner, id = sent.at(-1)?.[1]) => ipcMain.emit('document:close-ready', event, id, saved);
  return { win, ipcMain, sent, prompts, owner, register, acknowledge };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('an untouched loading window can close before its renderer registers', () => {
  const { win, ipcMain } = fixture();
  win.close();
  assert.equal(win.isDestroyed(), true);
  assert.equal(ipcMain.listenerCount('document:close-ready'), 0);
});

test('closing waits for the owning main frame and its current save request', () => {
  const f = fixture();
  f.register(); f.win.close(); f.win.close();
  assert.equal(f.win.isDestroyed(), false);
  assert.equal(f.win.isEnabled(), false);
  assert.equal(f.sent.length, 1);
  f.acknowledge(true, { ...f.owner, senderFrame: {} });
  f.acknowledge(true, f.owner, 'old-request');
  assert.equal(f.win.isDestroyed(), false);
  f.acknowledge(true);
  assert.equal(f.win.isDestroyed(), true);
  assert.equal(f.ipcMain.listenerCount('document:close-ready'), 0);
});

test('save failure defaults to keeping the window open and permits a retry', async () => {
  const f = fixture(); f.register(); f.win.close(); f.acknowledge(false);
  await nextTurn();
  assert.equal(f.win.isDestroyed(), false);
  assert.equal(f.prompts[0].defaultId, 0);
  assert.equal(f.win.isEnabled(), true);
  assert.equal(f.prompts[0].cancelId, 0);
  f.win.close(); assert.equal(f.sent.length, 2);
  f.acknowledge(true); assert.equal(f.win.isDestroyed(), true);
});

test('a stalled renderer can close only after explicit discard and listeners are removed', async () => {
  const f = fixture(1, 10); f.register(); f.win.close();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.prompts.length, 1);
  assert.equal(f.win.isDestroyed(), true);
  assert.equal(f.ipcMain.listenerCount('document:close-handler-ready'), 0);
});
