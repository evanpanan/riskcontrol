import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsSections, SettingsSection } from '../src/components/settings-Sections';
(globalThis as any).React = React;
function render(readOnly: boolean) {
  return renderToStaticMarkup(React.createElement(SettingsSections, { sections: [{id:'first',label:'第一节'},{id:'second',label:'第二节'}], readOnly,
    children: [
      React.createElement(SettingsSection,{key:'first',id:'first',children:React.createElement('input',{defaultValue:'draft-a'})}),
      React.createElement(SettingsSection,{key:'second',id:'second',children:React.createElement('input',{defaultValue:'draft-b'})}),
    ] }));
}
const editable = render(false);
assert.ok(editable.includes('draft-a') && editable.includes('draft-b'), 'inactive sections must remain mounted with their form drafts');
assert.equal((editable.match(/aria-current="page"/g)||[]).length,1);
assert.equal((editable.match(/hidden=""/g)||[]).length,1, 'exactly the inactive section is hidden');
assert.ok(editable.includes('style="display:none"'));
const readonly = render(true);
const nav = readonly.slice(readonly.indexOf('<nav'), readonly.indexOf('</nav>'));
assert.ok(!nav.includes('disabled'), 'read-only operators must still navigate');
assert.equal((readonly.match(/<fieldset disabled=""/g)||[]).length,2, 'read-only applies to every form');
assert.ok(readonly.includes('<select'), 'mobile section selector remains available');
console.log('PASS: one active section, inactive forms remain mounted, readonly fields with usable navigation and mobile selector');
