const gallery = document.querySelector('#gallery');
const area = document.querySelector('#area');
area.addEventListener('change', () => {
  let count = 0;
  document.querySelectorAll('.comparison').forEach(card => {
    card.hidden = area.value !== 'All' && card.dataset.area !== area.value;
    if (!card.hidden) count++;
  });
  document.querySelector('#count').textContent = `${count} comparisons`;
});
document.querySelectorAll('[data-mode]').forEach(button => {
  if (button.tagName !== 'BUTTON') return;
  button.addEventListener('click', () => {
    gallery.dataset.mode = button.dataset.mode;
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  });
});
const dialog = document.querySelector('#lightbox');
let opener;
document.querySelectorAll('.shot').forEach(button => button.addEventListener('click', () => {
  opener = button;
  const img = document.querySelector('#lightbox-image');
  img.src = button.dataset.image;
  img.alt = button.dataset.caption;
  document.querySelector('#lightbox-caption').textContent = button.dataset.caption;
  dialog.showModal();
  dialog.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}));
document.querySelector('#close-lightbox').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if(event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close(); }});
dialog.addEventListener('close', () => {document.body.style.overflow = '';opener?.focus({preventScroll:true});});
// Demo is entirely local. It demonstrates UI states without making any request.
let timer, tick, elapsed = 0, state = 'ready', revised = false, correction = '';
const demo = document.querySelector('#demo-body');
const safe = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const clearTimers = () => {clearTimeout(timer);clearInterval(tick);};
function render(next){
  clearTimers();state=next;
  if(next==='ready'||next==='stopped') demo.innerHTML=`<h3>DESCRIBE YOUR FOOD.</h3><p class="ready">● AI ready</p><label for="demo-food">DESCRIPTION</label><textarea id="demo-food" readonly>A chicken bowl with rice and vegetables</textarea>${next==='stopped'?'<p>Stopped. Your draft is still here.</p>':''}<button class="lime" data-action="analyze">Analyze with AI</button>`;
  if(next==='working'){
    elapsed=0;
    demo.innerHTML='<h3>WORKING ON IT.</h3><div class="mock-panel"><b><i class="spinner"></i>Estimating your food…</b><p><span id="elapsed">0</span>s elapsed · You’ll review the result before using it.</p><button data-action="stop">Stop request</button></div><p>This demo completes in 3 seconds. Corrections use a fixed half-portion example.</p>';
    tick=setInterval(()=>{elapsed++;document.querySelector('#elapsed').textContent=elapsed;},1000);
    timer=setTimeout(()=>render('review'),3000);
  }
  if(next==='review')demo.innerHTML=`<h3>AI ESTIMATE — REVIEW.</h3><p>Not logged yet. Check the portions, edit any number, or tell AI what to change.</p><div class="mock-number"><span>${revised?'Chicken bowl, half':'Chicken bowl'}</span><strong>${revised?'320':'640'} kcal</strong></div><label for="demo-correction">CORRECT OR CLARIFY</label><textarea id="demo-correction" placeholder="e.g. I ate half, no sauce">${safe(correction)}</textarea><button data-action="correct" ${correction.trim()?'':'disabled'}>Update estimate</button><p>Your note updates this estimate. Nothing is logged until you tap Add.</p><button class="lime" data-action="save">Add 1 item →</button>`;
  if(next==='error')demo.innerHTML='<h3>LET’S TRY AGAIN.</h3><div class="mock-panel error"><p>Could not reach AI. Check your connection, then try again.</p><button data-action="retry">Try again</button></div><p>Your draft is still here. Manual entry remains available in the app.</p>';
  if(next==='saved')demo.innerHTML='<h3 class="saved">FOOD LOGGED ✓</h3><p>The save is complete. The application shows a confirmation with Undo for this food-add flow.</p><button data-action="undo">Undo</button><button data-action="reset">Start again</button>';
}
demo.addEventListener('input',event=>{if(event.target.id==='demo-correction'){correction=event.target.value;demo.querySelector('[data-action="correct"]').disabled=!correction.trim();}});
demo.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;if(action==='analyze'||action==='retry')render('working');if(action==='stop')render('stopped');if(action==='correct'){revised=true;render('working');}if(action==='save')render('saved');if(action==='undo')render('review');if(action==='reset')reset();});
function reset(){revised=false;correction='';render('ready');}
document.querySelector('#demo-reset').addEventListener('click',reset);
document.querySelector('#demo-error').addEventListener('click',()=>render('error'));
render('ready');
function revealHash(){const target=document.getElementById(location.hash.slice(1));if(target?.classList.contains('comparison')&&target.hidden){area.value='All';area.dispatchEvent(new Event('change'));target.scrollIntoView();}}
window.addEventListener('hashchange',revealHash);revealHash();
