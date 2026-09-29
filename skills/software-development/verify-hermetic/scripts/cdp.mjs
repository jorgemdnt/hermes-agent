#!/usr/bin/env node
// Installed-app CDP driver. Targets only the supplied DevToolsActivePort.
import fs from 'node:fs';
const args = process.argv.slice(2);
const ix = args.indexOf('--port');
if (ix < 0 || !args[ix + 1]) throw Error('usage: cdp.mjs --port PORT doctor|text|eval JS|click SELECTOR|key KEY|resize WIDTH HEIGHT|theme light|dark|shot FILE|navigate URL|close');
const port = Number(args[ix + 1]);
const commandArgs = args.slice(ix + 2);
const widthFlag = commandArgs.indexOf('--width');
const mobileWidth = widthFlag < 0 ? null : Number(commandArgs.splice(widthFlag, 2)[1]);
const [command, ...rest] = commandArgs;
const endpoint = `http://127.0.0.1:${port}`;
const targets = await (await fetch(`${endpoint}/json`)).json();
const target = command === 'close' ? await (await fetch(`${endpoint}/json/version`)).json()
  : targets.find(t => t.type === 'page' && /^https?:\/\//.test(t.url));
if (!target) throw Error('No HTTP(S) app page at supplied port');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let serial = 0;
const pending = new Map();
ws.onmessage = event => { const msg = JSON.parse(event.data); const task = pending.get(msg.id); if (task) { pending.delete(msg.id); msg.error ? task.reject(Error(JSON.stringify(msg.error))) : task.resolve(msg.result); } };
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}
try {
  if (mobileWidth !== null) {
    if (!Number.isInteger(mobileWidth) || mobileWidth < 320) throw Error('invalid --width');
    await send('Emulation.setDeviceMetricsOverride', { width: mobileWidth, height: 844, deviceScaleFactor: 1, mobile: mobileWidth < 600 });
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  switch (command) {
    case 'cookies': {
      const data = await send('Storage.getCookies');
      console.log(JSON.stringify(data.cookies.map(({ name, domain, path, secure, expires }) => ({ name, domain, path, secure, expires })))); break;
    }
    case 'doctor': console.log(JSON.stringify({ page: target.url, title: target.title, port })); break;
    case 'text': console.log(await evaluate('document.body.innerText')); break;
    case 'eval': console.log(JSON.stringify(await evaluate(rest.join(' ')))); break;
    case 'click': {
      const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(rest[0])}); if (!e) throw Error('missing selector'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; })()`);
      if (!box.w || !box.h) throw Error('element has zero area');
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      console.log(JSON.stringify(box)); break;
    }
    case 'scroll': {
      const selector = rest[0], deltaY = Number(rest[1]);
      const box = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`);
      await send('Input.dispatchMouseEvent', { type:'mouseWheel', x:box.x, y:box.y, deltaX:0, deltaY });
      console.log(JSON.stringify({selector,deltaY})); break;
    }
    case 'attach': {
      const root = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: rest[0] });
      if (!node.nodeId) throw Error('missing file input');
      await send('DOM.setFileInputFiles', { files: [rest[1]], nodeId: node.nodeId });
      console.log(`attached ${rest[1]}`); break;
    }
    case 'fill': {
      const selector = rest[0], value = rest[1];
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
      await send('Input.dispatchKeyEvent', { type:'keyDown', key:'a', code:'KeyA', modifiers:4 });
      await send('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:4 });
      await send('Input.insertText', { text:value }); console.log(selector); break;
    }
    case 'signin': {
      const fixture = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
      for (const [selector, value] of [['input[name="username"]', 'qa-user'], ['input[name="password"]', fixture.password]]) {
        await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
        await send('Input.insertText', { text: value });
      }
      const box = await evaluate(`(() => { const r=document.querySelector('form button[type="submit"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`);
      for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x:box.x,y:box.y,button:'left',clickCount:1});
      console.log('submitted QA-only login'); break;
    }
    case 'key': {
      const key = rest[0], modifiers = Number(rest[1] || 0);
      const enter = key === 'Enter';
      const fields = enter ? { key, code: key, modifiers, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 } : { key, code: key, modifiers };
      await send('Input.dispatchKeyEvent', { type: enter ? 'rawKeyDown' : 'keyDown', ...fields });
      if (enter) await send('Input.dispatchKeyEvent', { type: 'char', ...fields, text: '\r', unmodifiedText: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...fields });
      console.log(`${key} ${modifiers}`); break;
    }
    case 'resize': await send('Emulation.setDeviceMetricsOverride', { width: Number(rest[0]), height: Number(rest[1]), deviceScaleFactor: 1, mobile: Number(rest[0]) < 600 }); console.log(rest.join('x')); break;
    case 'theme': await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: rest[0] }] }); console.log(rest[0]); break;
    case 'shot': {
      const path = rest[0]; fs.mkdirSync(new URL('.', `file://${path}`).pathname, { recursive: true });
      if (rest[1] && rest[2]) {
        const width = Number(rest[1]), height = Number(rest[2]);
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: rest[3] || 'light' }] });
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      const dimensions = await evaluate('({width:innerWidth,height:innerHeight,theme:document.querySelector(".m-shell")?.dataset.theme})');
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path, Buffer.from(shot.data, 'base64')); console.log(JSON.stringify({path,...dimensions})); break;
    }
    case 'navigate': await send('Page.navigate', { url: rest[0] }); console.log(rest[0]); break;
    case 'close': ws.send(JSON.stringify({id:++serial,method:'Browser.close'})); await new Promise(resolve => setTimeout(resolve, 200)); console.log('close requested'); break;
    default: throw Error(`unknown command ${command}`);
  }
} finally { ws.close(); }
