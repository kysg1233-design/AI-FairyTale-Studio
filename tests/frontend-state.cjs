const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const element = () => ({value:'',textContent:'',className:'',children:[],append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});
const storage = new Map();
let scheduled = 0;
const context = vm.createContext({
 window:{FAIRYTALE_CONFIG:{}}, document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element},
 sessionStorage:{getItem(){return null}},localStorage:{setItem(k,v){storage.set(k,v)}},
 setTimeout(){scheduled++;return scheduled},clearTimeout(){},clearInterval(){},console
});
vm.runInContext(fs.readFileSync('app.js','utf8').replace(/init\(\);\s*$/, ''),context);
(async()=>{
 vm.runInContext("$('title').value='새 이야기';$('story').value='아직 생성하지 않은 원고';$('cuts').value='3';persist();",context);
 assert.equal(JSON.parse(storage.get('fairytale-studio-v2')).draft.story,'아직 생성하지 않은 원고');
 vm.runInContext("state.project={id:'p',jobId:'j'};history=()=>{};api=async()=>({status:'complete'});",context);
 await vm.runInContext("poll('j')",context);
 assert.equal(scheduled,0,'Completed jobs must not schedule another request');
 vm.runInContext("api=async()=>({status:'failed'});",context);
 await vm.runInContext("poll('j')",context);
 assert.equal(scheduled,0,'Failed jobs must not schedule another request');
 vm.runInContext("api=async()=>({status:'running'});",context);
 await vm.runInContext("poll('j')",context);
 assert.equal(scheduled,1,'Active jobs schedule one request after the response');
 vm.runInContext("api=async()=>{state.project=null;return {status:'complete'}};$('renderStatus').textContent='new project';",context);
 await vm.runInContext("poll('j')",context);
 assert.equal(elements.get('renderStatus').textContent,'new project','Stale responses must not affect a different project');
 assert.equal(scheduled,1);
 console.log('Draft persistence and terminal/stale polling checks PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
