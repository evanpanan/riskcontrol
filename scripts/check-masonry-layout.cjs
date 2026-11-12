const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const filename = 'src/components/ui/masonry-cards.tsx';
let heights = [120, 260, 183.5];
const items = heights.map((_, index) => ({ style: {}, firstElementChild: { getBoundingClientRect: () => ({ height: heights[index] }) } }));
const root = { children: items };
const effects = [];
let onResize, disconnected = false;
global.ResizeObserver = class { constructor(callback) { onResize = callback; } observe() {} disconnect() { disconnected = true; } };
global.requestAnimationFrame = fn => { fn(); return 1; };
global.cancelAnimationFrame = () => {};
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const output = { exports: {} };
new Function('require', 'module', 'exports', code)(name => {
  if (name === 'react') return { Children: { toArray: x => x }, useRef: () => ({current: root}), useLayoutEffect: fn => effects.push(fn) };
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}) };
  throw new Error(name);
}, output, output.exports);
output.exports.MasonryCards({children: ['a','b','c']});
const cleanup = effects[0]();
function verify() {
  for (let i = 0; i < items.length; i++) {
    const span = Number(items[i].style.gridRowEnd.split(' ')[1]);
    const allocated = span + (span - 1) * 12;
    assert.ok(allocated >= heights[i], 'content must not overlap the next card');
    assert.ok(allocated - heights[i] < 13, 'rounding gap must remain smaller than a row step');
  }
}
verify();
heights = [165, 205.25, 440]; onResize(); verify();
cleanup(); assert.equal(disconnected, true);
console.log('PASS: unequal natural heights pack without row-sized holes; resize recalculates spans without clipping; observers cleaned up');
