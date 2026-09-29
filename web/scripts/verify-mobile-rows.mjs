// Run against the installed Hermetic fixture: HERMETIC_CDP_PORT=... node web/scripts/verify-mobile-rows.mjs
import assert from 'node:assert/strict';
const port = Number(process.env.HERMETIC_CDP_PORT);
assert.ok(port, 'HERMETIC_CDP_PORT must point to an isolated installed-app fixture');
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(target.url));
assert.ok(page, 'fixture page missing');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let serial = 0;
const pending = new Map();
socket.onmessage = ({ data }) => { const result = JSON.parse(data); const task = pending.get(result.id); if (task) { pending.delete(result.id); result.error ? task.reject(result.error) : task.resolve(result.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertRows = async (label, selector) => {
  await sleep(250);
  const rows = await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(element => {
    const style=getComputedStyle(element);return {name:element.innerText.slice(0,40),selected:element.getAttribute('aria-current'),shadow:style.boxShadow,left:style.borderLeftWidth,color:style.borderLeftColor};
  })`);
  assert.ok(rows.some(row => row.selected === 'page'), `${label}: no selected row rendered`);
  for (const row of rows) {
    assert.equal(row.shadow, 'none', `${label} ${row.name}: inset/left shadow`);
    assert.equal(row.left, '0px', `${label} ${row.name}: left border`);
  }
  console.log(`${label}: ${rows.length} rendered rows, selected and unselected without left accents`);
};
try {
  const origin = await evaluate(`location.origin`);
  await send('Page.navigate', { url: `${origin}/m/chat/default/qa-default-short?mode=chats` });
  await sleep(1000);
  for (const width of [390, 768, 1024, 1440, 1920]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(450);
    for (const theme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await assertRows(`${width} ${theme} chats`, '.m-chat-row');
    }
  }
  const botUrl = await evaluate(`location.origin + location.pathname + '?mode=bots'`);
  await send('Page.navigate', { url: botUrl });
  await sleep(1000);
  await assertRows('1920 bots', '.m-bot-main, .m-pinned-bot');
} finally { socket.close(); }
