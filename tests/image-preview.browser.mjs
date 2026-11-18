import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = new URL(process.argv[2]);
assert.equal(url.hostname, "127.0.0.1", "Use the isolated local test page");
assert.equal(url.pathname, "/image-preview-check");
const artifacts = path.resolve(process.argv[3]);
await mkdir(artifacts, { recursive: true });
const root = fileURLToPath(new URL("../", import.meta.url));
const route = path.join(root, "src/app/image-preview-check");
const asset = path.join(root, "public/image-preview-check.svg");
assert.ok(!existsSync(route) && !existsSync(asset), "Fixture paths must be unused");
const browser = process.env.WIKI_TEST_BROWSER || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert.ok(browser, "Set WIKI_TEST_BROWSER to an installed Chromium browser");
const profile = await mkdtemp(path.join(artifacts, "browser-profile-"));
const processHandle = spawn(browser, [
  "--headless=new", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let diagnostics = "";
processHandle.stderr.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(message);
}
let socket;
let command;
let evaluate;
const passed = [];
let ownsRoute = false;
let ownsAsset = false;
try {
  await mkdir(route);
  ownsRoute = true;
  await writeFile(path.join(route, "page.tsx"), await readFile(new URL("./fixtures/image-preview/page.tsx", import.meta.url)), { flag: "wx" });
  await writeFile(asset, await readFile(new URL("./fixtures/image-preview/graphic.svg", import.meta.url)), { flag: "wx" });
  ownsAsset = true;
  // Next's file watcher can briefly serve the previous 404 after fixture creation.
  await until(async () => {
    const response = await fetch(url);
    return response.ok && (await response.text()).includes("Wiki image interaction check");
  }, "Temporary test route did not become ready", 45000);
  const portFile = path.join(profile, "DevToolsActivePort");
  const port = await until(async () => {
    try { return Number((await readFile(portFile, "utf8")).split("\n")[0]) || null; }
    catch (error) { if (["ENOENT", "EBUSY"].includes(error.code)) return null; throw error; }
  }, `Browser failed to start: ${diagnostics}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const requests = new Map();
  socket.onmessage = (event) => {
    const result = JSON.parse(event.data);
    const request = requests.get(result.id);
    if (!request) return;
    requests.delete(result.id);
    if (result.error) request.reject(new Error(JSON.stringify(result.error)));
    else request.resolve(result.result);
  };
  command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const rect = async (selector) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
  const click = async (selector) => {
    const position = await rect(selector);
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: position.x, y: position.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: position.x, y: position.y, button: "left", clickCount: 1 });
    await sleep(80);
  };
  const key = async (key, code = key) => {
    const windowsVirtualKeyCode = { Escape: 27, Enter: 13, Tab: 9, " ": 32 }[key];
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    await sleep(80);
  };
  const opened = () => evaluate(`!!document.querySelector('dialog[open][aria-label="图片预览"]')`);
  const zoom = () => evaluate(`parseInt(document.querySelector('output[aria-label="缩放比例"]').textContent)`);
  const frame = () => evaluate(`(() => {const e=document.querySelector('[aria-label="图片查看区域"] [role="img"]');const m=new DOMMatrix(getComputedStyle(e).transform);return {x:m.e,y:m.f,scale:m.a}})()`);
  const image = '.wiki-content img[alt="Test image"]';
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: url.href });
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(image)})?.naturalWidth`), "Test image did not load", 45000);
  const oldOverflow = await evaluate("document.body.style.overflow");
  await click(image);
  await until(opened, "Clicking a wiki image must open an image preview", 3000);
  passed.push("image opens a modal");
  await click('[aria-label="放大图片"]');
  assert.ok(await zoom() > 100);
  const canvas = await rect('[aria-label="图片查看区域"]');
  const beforeWheel = await zoom();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvas.x, y: canvas.y, deltaX: 0, deltaY: -300 });
  await sleep(100);
  assert.ok(await zoom() > beforeWheel);
  const beforeDrag = await frame();
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: canvas.x, y: canvas.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvas.x + 90, y: canvas.y + 50, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: canvas.x + 90, y: canvas.y + 50, button: "left", clickCount: 1 });
  await until(async () => JSON.stringify(await frame()) !== JSON.stringify(beforeDrag), "Dragging must move the enlarged image", 3000);
  assert.ok(await opened(), "Dragging must not dismiss the image");
  passed.push("desktop controls, wheel and drag");
  await click('[aria-label="适应窗口"]');
  assert.equal(await zoom(), 100);
  assert.equal(await evaluate(`document.querySelector('[aria-label="缩小图片"]').disabled`), true);
  await key("Escape");
  assert.equal(await opened(), false);
  assert.equal(await evaluate("document.body.style.overflow"), oldOverflow);
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(image)})`), true);
  await key("Enter");
  assert.ok(await opened());
  await key("Tab");
  assert.ok(await evaluate(`document.querySelector('dialog[open]').contains(document.activeElement)`));
  await key("Escape");
  passed.push("keyboard opening, modal focus, escape and restored focus/scroll");
  await click('.wiki-content svg[aria-label*="Inline architecture"]');
  assert.ok(await opened());
  assert.ok(await evaluate(`!!document.querySelector('dialog[open] svg[viewBox="0 0 900 450"]')`));
  await click('[aria-label="放大图片"]');
  await command("Page.captureScreenshot", { format: "png" }).then((r) => writeFile(path.join(artifacts, "desktop-image-preview.png"), Buffer.from(r.data, "base64")));
  await key("Escape");
  await click('.wiki-content a[href="#target"] img');
  assert.equal(await opened(), false);
  passed.push("inline SVG and preserved image-link navigation");
  await until(() => evaluate(`!!document.querySelector('.mermaid-rendered svg[data-wiki-image-preview]')`), "Asynchronous Mermaid must get a preview entry");
  await click('.mermaid-rendered svg');
  assert.ok(await opened());
  assert.ok(await evaluate(`!!document.querySelector('dialog[open] .mermaid-rendered svg')`));
  await key("Escape");
  await click('.wiki-content img[alt="Unavailable image"]');
  assert.ok(await evaluate(`document.querySelector('dialog[open] [role="status"]').textContent.includes('无法加载')`));
  await key("Escape");
  passed.push("asynchronous Mermaid and unavailable image recovery");
  await evaluate(`document.documentElement.setAttribute('data-theme','light')`);
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await click(image);
  const touchCanvas = await rect('[aria-label="图片查看区域"]');
  await evaluate(`window.touchTrace=[]; for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) document.querySelector('[aria-label="图片查看区域"]').addEventListener(type,e=>window.touchTrace.push({type,id:e.pointerId,x:e.clientX,y:e.clientY}))`);
  const points = (distance) => [{ id: 1, x: touchCanvas.x - distance, y: touchCanvas.y }, { id: 2, x: touchCanvas.x + distance, y: touchCanvas.y }];
  await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(35) });
  for (const distance of [45, 55, 65, 75]) await command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(distance) });
  await sleep(100);
  const beforeTouchPan = await frame();
  const remaining = points(75).slice(0, 1);
  // CDP touchEnd lists the released contact; keep the first finger down.
  await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: points(75).slice(1) });
  await command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: remaining.map((point) => ({ ...point, x: point.x + 50, y: point.y + 25 })) });
  await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(async () => JSON.stringify(await frame()) !== JSON.stringify(beforeTouchPan), "Switching from pinch to one-finger drag must pan the image", 3000);
  assert.ok(await opened(), "Touch dragging must keep the image open");
  await sleep(100);
  assert.ok(await zoom() > 150, "Two-finger pinch must zoom the image");
  assert.equal(await evaluate("window.visualViewport.scale"), 1, "Pinch must zoom the image rather than the page");
  for (const label of ["关闭图片预览", "放大图片", "缩小图片", "适应窗口"]) {
    const bounds = await evaluate(`(() => {const r=document.querySelector('[aria-label="${label}"]').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()`);
    assert.ok(bounds.x >= 0 && bounds.right <= 390 && bounds.width >= 44 && bounds.height >= 44);
  }
  await command("Page.captureScreenshot", { format: "png" }).then((r) => writeFile(path.join(artifacts, "mobile-image-preview.png"), Buffer.from(r.data, "base64")));
  passed.push("touch pinch, pinch-to-one-finger pan and reachable mobile controls");
  await command("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  assert.ok(await opened());
  await click('[aria-label="适应窗口"]');
  assert.equal(await zoom(), 100);
  await click('[aria-label="关闭图片预览"]');
  assert.equal(await opened(), false);
  assert.equal(await evaluate("document.body.style.overflow"), oldOverflow);
  passed.push("landscape resize and touch close");
  await writeFile(path.join(artifacts, "browser-check.json"), JSON.stringify({ status: "passed", passed, browser }, null, 2));
  console.log(JSON.stringify({ status: "passed", passed }));
} catch (error) {
  if (!socket) error.message += ` (browser exit=${processHandle.exitCode}; ${diagnostics})`;
  if (evaluate) await evaluate(`document.querySelector('dialog[open]')?.outerHTML ?? document.body.innerHTML`).then((html) => writeFile(path.join(artifacts, "failure-dom.html"), html)).catch(() => {});
  if (command) await command("Page.captureScreenshot", { format: "png" }).then((r) => writeFile(path.join(artifacts, "failure.png"), Buffer.from(r.data, "base64"))).catch(() => {});
  const touchTrace = evaluate ? await evaluate("window.touchTrace ?? []").catch(() => []) : [];
  await writeFile(path.join(artifacts, "browser-check.json"), JSON.stringify({ status: "failed", passed, message: error.message, stack: error.stack, touchTrace }, null, 2));
  console.error(error.message.split("\n")[0]);
  process.exitCode = 1;
} finally {
  if (command && socket?.readyState === WebSocket.OPEN) await Promise.race([command("Browser.close").catch(() => {}), sleep(1000)]);
  socket?.close();
  processHandle.kill();
  await sleep(700);
  assert.equal(path.dirname(profile), artifacts);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
  if (ownsAsset) await rm(asset, { force: true });
  if (ownsRoute) { await rm(path.join(route, "page.tsx"), { force: true }); await rmdir(route); }
}
