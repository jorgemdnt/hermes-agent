// Run against the dashboard: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node web/scripts/verify-mobile-accent.mjs http://127.0.0.1:9130 /path/to/evidence
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const base = process.argv[2] || "http://127.0.0.1:9130";
const out = process.argv[3];
assert(out, "Pass an evidence directory");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
const report = { base, cases: [], screenshots: [], extra: [] };
const check = (condition, message) => assert(condition, message);
const shot = async (page, name) => { const file = path.join(out, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file); };

const settlePaint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Computed styles, not source-text assertions. Every expected target must exist.
async function colors(page, specs, source) {
  await settlePaint(page);
  const results = await page.evaluate(({ specs, source }) => {
    const shell = document.querySelector('.m-shell');
    const probe = document.createElement('span'); probe.style.transitionProperty = 'none'; shell.append(probe);
    const resolve = token => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    const results = specs.flatMap(([selector, property, token, pseudo]) => {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) return [{ source, selector, property, missing: true }];
      return elements.map(e => ({ source, selector, property, actual: getComputedStyle(e, pseudo || null)[property], expected: resolve(token), token }));
    });
    probe.remove(); return results;
  }, { specs, source });
  for (const item of results) check(!item.missing && item.actual === item.expected, `${source} ${item.selector} ${item.property}: ${item.actual} != ${item.expected}`);
  return results;
}

async function contrast(page) {
  await settlePaint(page);
  const result = await page.evaluate(() => {
    const shell = document.querySelector('.m-shell'); const probe = document.createElement('span'); probe.style.transitionProperty = 'none'; shell.append(probe);
    const rgb = token => { probe.style.color = `var(${token})`; const c=getComputedStyle(probe).color; return c.startsWith('color(srgb') ? c.match(/[\d.]+/g).map(Number).slice(0,3).map(n=>n*255) : c.match(/[\d.]+/g).map(Number).slice(0,3); };
    const lum = c => c.map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => (Math.max(lum(rgb(a)),lum(rgb(b)))+.05)/(Math.min(lum(rgb(a)),lum(rgb(b)))+.05);
    const fills = ratio('--accent','--accent-foreground');
    const text = Object.fromEntries(['--background','--card','--secondary','--accent-subtle','--chat-bubble'].map(s=>[s,ratio('--accent-text',s)]));
    probe.remove(); return { fills, text };
  });
  check(result.fills >= 4.5, `Accent foreground contrast ${result.fills}`);
  for (const [surface, ratio] of Object.entries(result.text)) check(ratio >= 4.5, `Accent text contrast ${surface}: ${ratio}`);
  return result;
}

// Rare states are CSS contract fixtures (explicitly not screenshots or fake API data).
// The main controls below are exercised on actual live components and real conversations.
async function rareStates(page) {
  await page.evaluate(() => {
    const fixture = document.createElement('div'); fixture.id = 'accent-contract-fixture';
    fixture.style.cssText = 'position:absolute;left:-10000px;top:0;pointer-events:none;';
    fixture.innerHTML = `<div class="m-composer"><button class="m-steer-toggle" aria-pressed="true">Steer</button><button class="m-voice-stop">Dictation</button></div>
      <span class="m-streaming-caret"></span><span class="m-unread-dot"></span><span class="m-status-dot"></span><span class="m-badge">Request</span>
      <div class="m-typing"><span></span></div><div class="m-card"><label class="m-choice"><input type="checkbox"></label></div>
      <div class="m-sub-meter"><progress value="30" max="100"></progress></div>
      <ol class="m-creation-progress"><li data-state="active">Creating</li><li data-state="done">Created</li><li data-state="failed">Failed</li></ol>
      <div class="m-column"><h3>Running <small>1</small></h3></div><span class="m-task-live">Running</span>
      <button class="m-jump-latest">Latest</button><button class="m-pinned-scroll">Scroll</button>
      <div class="m-terminal-dock"><div class="m-terminal-tab"><button aria-pressed="true">Terminal</button></div></div>
      <div class="m-split-header"><button role="tab" aria-selected="true">Files</button></div>
      <div class="m-split-file-list"><button aria-current="true">File</button></div>
      <button class="m-reaction" aria-pressed="true">Like</button><span class="m-home-switch-badge">3</span>
      <div class="m-markdown"><a href="#contract">Link</a></div><button class="m-file-link">File</button><a class="m-link-preview"><strong>Preview</strong></a>
      <div class="m-screen-controlled"></div><div class="m-inline-request" data-method="clarify"><div class="m-card"></div></div>`;
    document.querySelector('.m-shell').append(fixture);
  });
  const specs = [
    ['.m-steer-toggle[aria-pressed="true"]','backgroundColor','--accent'], ['.m-steer-toggle[aria-pressed="true"]','color','--accent-foreground'],
    ['.m-voice-stop','backgroundColor','--accent'], ['.m-voice-stop','color','--accent-foreground'],
    ['.m-streaming-caret','backgroundColor','--accent'], ['.m-unread-dot','backgroundColor','--accent'], ['.m-status-dot','backgroundColor','--accent'],
    ['.m-typing span','backgroundColor','--accent'], ['.m-choice input','accentColor','--accent'], ['progress','accentColor','--accent'],
    ['.m-creation-progress [data-state="active"]','color','--accent-text'], ['.m-creation-progress [data-state="done"]','color','--success'], ['.m-creation-progress [data-state="failed"]','color','--destructive'],
    ['.m-column h3 small','backgroundColor','--accent-subtle'], ['.m-column h3 small','color','--accent-text'], ['.m-task-live','color','--accent-text'],
    ['.m-jump-latest','color','--accent-text'], ['.m-pinned-scroll','color','--accent-text'], ['.m-badge','color','--accent-text'], ['.m-badge','backgroundColor','--accent-subtle'],
    ['.m-terminal-tab','backgroundColor','--accent'], ['.m-terminal-tab','color','--accent-foreground'],
    ['.m-split-header [role="tab"]','backgroundColor','--accent-subtle'], ['.m-split-header [role="tab"]','color','--accent-text'],
    ['.m-split-file-list button','backgroundColor','--accent-subtle'], ['.m-split-file-list button','color','--accent-text'],
    ['.m-reaction','backgroundColor','--accent-subtle'], ['.m-reaction','color','--accent-text'], ['.m-home-switch-badge','backgroundColor','--accent'], ['.m-home-switch-badge','color','--accent-foreground'],
    ['.m-markdown a','color','--accent-text'], ['.m-file-link','color','--accent-text'], ['.m-link-preview strong','color','--accent-text'],
    ['.m-screen-controlled','borderTopColor','--ring'], ['.m-inline-request .m-card','borderLeftColor','--accent-text'],
  ].map(([selector, ...rest]) => [`#accent-contract-fixture ${selector}`, ...rest]);
  const results = await colors(page, specs, 'css-contract-fixture');
  await page.locator('#accent-contract-fixture').evaluate(e=>e.remove());
  return results;
}

async function sidebarShot(page, width, name) {
  if (width === 390) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:420}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:385,y:420}]});
    await page.waitForFunction(()=>new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.m-detail')).transform).m41 > 300);
    await shot(page,name);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await cdp.detach();
  } else await shot(page,name);
}

try {
  for (const width of [390,1440]) for (const theme of ['light','dark']) for (const accent of ['Neutral','Blue','Purple']) {
    const context = await browser.newContext({viewport:{width,height:width===390?844:1000},colorScheme:theme,reducedMotion:'reduce',hasTouch:width===390});
    await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
    const page=await context.newPage(); const name=`after-${width}-${theme}-${accent.toLowerCase()}`;
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/m/settings`); await page.getByRole('group',{name:'Appearance',exact:true}).getByRole('button',{name:theme==='dark'?'Dark':'Light',exact:true}).click();
    await page.getByRole('group',{name:'Accent color'}).getByRole('button',{name:accent,exact:true}).click();
    const saved=await page.evaluate(()=>localStorage.getItem('hermes-mobile-accent'));
    await page.reload(); await page.getByRole('group',{name:'Accent color'}).waitFor();
    check(await page.getByRole('group',{name:'Accent color'}).getByRole('button',{name:accent,exact:true}).getAttribute('aria-pressed')==='true','Preset survives reload');
    const row={width,theme,accent,saved,contrast:await contrast(page),styles:await rareStates(page)};
    row.styles.push(...await colors(page,[['.m-theme-choices button[aria-pressed="true"]','backgroundColor','--accent-subtle'],['.m-accent-choices button[aria-pressed="true"]','color','--accent-text']],'live-settings'));
    await shot(page,`${name}-settings`);
    await page.goto(`${base}/m`); await page.locator('.m-pinned-bot').first().click();
    const ed=page.getByRole('textbox',{name:'Message'}); await ed.waitFor(); await ed.fill('/architect');
    await page.getByRole('option').filter({hasText:'/architect'}).first().waitFor();
    const suggestionStyles = await colors(page, [['.m-suggestions button[aria-selected="true"]','backgroundColor','--accent-subtle'],['.m-suggestions button[aria-selected="true"]','color','--accent-text']], 'live-suggestions');
    row.styles.push(...suggestionStyles);
    await page.getByRole('option').filter({hasText:'/architect'}).first().click(); await ed.press('End'); await ed.type('Accent preview');
    await ed.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e.lastChild);const s=getSelection();s.removeAllRanges();s.addRange(range)});
    row.styles.push(...await colors(page,[['.m-send','backgroundColor','--accent'],['.m-send','color','--accent-foreground'],['.m-skill-pill','backgroundColor','--accent-subtle'],['.m-skill-pill','color','--accent-text'],['.m-skill-pill','borderTopColor','--accent-border'],['.m-skill-editor','caretColor','--accent-text'],['.m-skill-editor','outlineColor','--ring'],['.m-skill-editor','backgroundColor','--accent-selection','::selection'],['.m-skill-editor','color','--accent-selection-foreground','::selection'],['.m-pinned-bot[aria-current="page"]','backgroundColor','--accent-subtle'],['.m-pinned-bot[aria-current="page"]','borderTopColor','--ring'],['.m-home-switch-thumb','backgroundColor','--accent'],['.m-home-switch button[aria-checked="true"]','color','--accent-foreground']],'live-bot-chat'));
    check(await ed.evaluate(e=>e.matches(':focus-visible') && getComputedStyle(e).outlineStyle!=='none'),'Editor has visible accent focus ring');
    await shot(page,`${name}-chat`); await sidebarShot(page,width,`${name}-pinned`);
    const links=page.locator('.m-markdown a'); if(await links.count()) row.styles.push(...await colors(page,[['.m-markdown a','color','--accent-text']],'live-links'));
    if(width===390) await page.getByRole('button',{name:'Back to bots'}).click();
    await page.getByRole('radio',{name:'Chats',exact:true}).click(); await page.locator('.m-chat-row').first().waitFor();
    if(width===390) await page.waitForURL(/\/m\/chat\//);
    else await page.locator('.m-chat-row').first().click();
    await page.waitForSelector('.m-chat-row[aria-current="page"]');
    await sidebarShot(page,width,`${name}-sidebar`);
    row.styles.push(...await colors(page,[['.m-chat-row[aria-current="page"]','backgroundColor','--accent-subtle'],['.m-chat-row[aria-current="page"]','color','--accent-text']],'live-chat-row'));
    await page.goto(`${base}/m/board`); await page.locator('.m-column h3 small').first().waitFor();
    row.styles.push(...await colors(page,[['.m-column h3 small','backgroundColor','--accent-subtle'],['.m-column h3 small','color','--accent-text']],'live-board'));
    if(await page.locator('.m-task-live').count()) row.styles.push(...await colors(page,[['.m-task-live','color','--accent-text'],['.m-task-live .m-status-dot','backgroundColor','--accent']],'live-board-running'));
    check(errors.length===0,`Page errors: ${errors.join('; ')}`); report.cases.push(row); await context.close();
  }
  check(report.cases.length===12,'Complete width/theme/accent matrix');
  const page=await browser.newPage(); await page.goto(`${base}/m/settings`); await page.getByLabel('Custom hex').fill('#xyz');
  check(await page.getByLabel('Custom hex').getAttribute('aria-invalid')==='true','Invalid custom hex is rejected');
  await page.getByLabel('Custom hex').fill('#ff0'); await page.reload(); await page.getByLabel('Custom hex').waitFor();
  check(await page.evaluate(()=>localStorage.getItem('hermes-mobile-accent'))==='#ffff00','Custom short hex persists normalized');
  for(const theme of ['Light','Dark','System']) { await page.getByRole('group',{name:'Appearance',exact:true}).getByRole('button',{name:theme,exact:true}).click(); report.extra.push({theme,custom:'#ffff00',contrast:await contrast(page)}); }
  await page.emulateMedia({colorScheme:'dark'}); report.extra.push({theme:'System dark',contrast:await contrast(page)});
  await page.emulateMedia({colorScheme:'light'}); report.extra.push({theme:'System light',contrast:await contrast(page)});
  console.log(`PASS ${report.cases.length} live accent cases; ${report.cases.reduce((n,c)=>n+c.styles.length,0)} computed-style checks; ${report.screenshots.length} screenshots; custom hex + system-theme checks`);
} finally { fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2)); await browser.close(); }
