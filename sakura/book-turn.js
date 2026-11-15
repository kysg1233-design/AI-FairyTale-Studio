/* Sakura: independently implemented bidirectional pointer-driven book animation. */
(function(global){
'use strict';
class SakuraBookFlip{
 constructor(root,options={}){
  this.root=root;this.pages=[];this.index=0;this.events={};this.gesture=null;this.animating=false;
  this.duration=options.flippingTime||520;
  root.classList.add('sakura-book');root.style.touchAction='pan-y';
  this.onDown=this.onDown.bind(this);this.onMove=this.onMove.bind(this);this.onUp=this.onUp.bind(this);
  root.addEventListener('pointerdown',this.onDown);
  root.addEventListener('pointermove',this.onMove);
  root.addEventListener('pointerup',this.onUp);
  root.addEventListener('pointercancel',this.onUp);
 }
 on(event,callback){(this.events[event]??=[]).push(callback)}
 emit(event,value){for(const cb of this.events[event]||[])cb({data:value})}
 loadFromHTML(pages){
  this.pages=pages;this.index=0;this.root.replaceChildren(...pages);
  for(const p of pages){p.classList.add('sakura-page');p.style.display='none'}
  this.showPage(0);
 }
 showPage(index){this.pages.forEach((p,i)=>{p.style.display=i===index?'flex':'none';p.style.visibility='visible'})}
 getCurrentPageIndex(){return this.index}
 onDown(e){
  if(this.animating||this.gesture||!this.pages.length||e.button!==0||e.target.closest('button,a'))return;
  this.gesture={pointerId:e.pointerId,x:e.clientX,y:e.clientY,dir:0,progress:0,active:false,startIndex:this.index};
 }
 begin(dir){
  const g=this.gesture;if(!g||this.animating)return false;
  const target=this.index+dir;if(target<0||target>=this.pages.length)return false;
  const source=dir>0?this.pages[this.index]:this.pages[target];
  const under=dir>0?this.pages[target]:this.pages[this.index];
  under.style.display='flex';
  const layer=source.cloneNode(true);
  layer.classList.add('sakura-turn-sheet');layer.style.display='flex';
  layer.style.pointerEvents='none';layer.setAttribute('aria-hidden','true');
  this.root.append(layer);g.layer=layer;g.target=target;g.dir=dir;g.active=true;
  if(dir>0)this.pages[this.index].style.visibility='hidden';
  this.paint(g,0);return true;
 }
 paint(g,p){
  const progress=Math.max(0,Math.min(1,p));g.progress=progress;
  const deg=-180*(g.dir>0?progress:1-progress);
  g.layer.style.transform='rotateY('+deg+'deg)';
  g.layer.style.filter='drop-shadow('+Math.round(7*progress)+'px 2px 9px rgba(48,24,37,.28))';
 }
 onMove(e){
  const g=this.gesture;if(!g||g.pointerId!==e.pointerId||this.animating)return;
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.active){
   if(Math.abs(dx)<13||Math.abs(dx)<Math.abs(dy)*1.15)return;
   if(!this.begin(dx<0?1:-1))return;
   try{this.root.setPointerCapture(e.pointerId)}catch(_){}
  }
  const width=Math.max(1,this.root.getBoundingClientRect().width);
  this.paint(g,Math.max(0,(g.dir>0?-dx:dx)/width));
  if(e.cancelable)e.preventDefault();
 }
 onUp(e){
  const g=this.gesture;if(!g||g.pointerId!==e.pointerId)return;
  this.gesture=null;
  if(g.active){this.finish(g,g.progress>.23||((g.dir>0?g.x-e.clientX:e.clientX-g.x)>75));return}
  if(e.type==='pointercancel'||Math.abs(e.clientX-g.x)>12||Math.abs(e.clientY-g.y)>12)return;
  const rect=this.root.getBoundingClientRect();
  this.flipTo(this.index+(e.clientX-rect.left>=rect.width/2?1:-1));
 }
 finish(g,commit){
  if(this.animating||!g.layer)return;
  this.animating=true;const end=commit?1:0;
  g.layer.style.transition='transform '+Math.max(170,Math.round(this.duration*Math.abs(end-g.progress)))+'ms ease-out';
  requestAnimationFrame(()=>this.paint(g,end));
  const done=()=>{
   if(!this.animating)return;
   g.layer.remove();this.animating=false;
   if(commit){this.index=g.target;this.showPage(this.index);this.emit('flip',this.index)}
   else this.showPage(this.index);
  };
  g.layer.addEventListener('transitionend',done,{once:true});
  setTimeout(done,this.duration+220);
 }
 flipTo(target){
  if(this.animating||this.gesture||target<0||target>=this.pages.length||Math.abs(target-this.index)!==1)return;
  this.gesture={pointerId:-1,x:0,y:0};
  const g=this.gesture;if(!this.begin(target>this.index?1:-1)){this.gesture=null;return}
  this.gesture=null;this.finish(g,true);
 }
 flipNext(){this.flipTo(this.index+1)}
 flipPrev(){this.flipTo(this.index-1)}
 turnToPage(index){
  const next=Math.max(0,Math.min(this.pages.length-1,index));
  if(this.animating)return;this.index=next;this.showPage(next);this.emit('flip',next);
 }
 destroy(){
  this.root.removeEventListener('pointerdown',this.onDown);
  this.root.removeEventListener('pointermove',this.onMove);
  this.root.removeEventListener('pointerup',this.onUp);
  this.root.removeEventListener('pointercancel',this.onUp);
  this.root.classList.remove('sakura-book');this.root.replaceChildren();this.pages=[];this.gesture=null;
 }
}
global.SakuraBookFlip=SakuraBookFlip;
})(window);
