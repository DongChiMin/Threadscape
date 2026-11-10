const Logic=(()=>{
 // Pure game logic (no DOM). Source of truth; `node build.js` splices it into index.html.
 const COLORS='RGBYVPONTK'; // R coral, G leaf, B sky, Y sunflower, V violet, P pink, O orange, N brown, T teal, K charcoal
 const DIFFICULTY=[ // tunable: spools per color (kmin..kmax), min spool length, anchors/holes, candidates tried
  {to:5, minLen:2,prefLen:2,kmin:1,kmax:1,pre:0,   torn:0,cands:6},
  {to:15,minLen:2,prefLen:2,kmin:1,kmax:2,pre:.12, torn:0,cands:40},  // spec says 2-3 spools/color; bot showed that is too trap-heavy
  {to:20,minLen:1,prefLen:2,kmin:1,kmax:1,pre:.12, torn:3,cands:40}]; // spec 3-5; bot: >1 spool per region is brutal. L16+ may use 1-cell spools but they are penalised
 const GEN_NODE_LIMIT=20000, GEN_BOT_RUNS=40, DEAD_MAX=300000;
 const failTarget=n=>n<=5?0:Math.min(.28,.05+(n-6)*.016); // target bot fail rate (3 hearts): 5% at L6 rising to ~28% at L20
 const DEAD=new Set(); // known-unsolvable (w,cells,lengths) states; adjacency depends only on w, so it is level-independent

 function mulberry32(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
 const adjCache={};
 function adj(w,h){const k=w+'x'+h;if(adjCache[k])return adjCache[k];const A=[];for(let i=0;i<w*h;i++){const r=i/w|0,c=i%w,o=[];if(r>0)o.push(i-w);if(r<h-1)o.push(i+w);if(c>0)o.push(i-1);if(c<w-1)o.push(i+1);A.push(o)}return adjCache[k]=A}
 const neighbors=(level,i)=>adj(level.w,level.h)[i];
 const cell=(level,i)=>level.cells[i];
 function makeState(level,stitched=new Set(level.prestitch),spools=level.spools){return{level,stitched,spools}}
 function remaining(state,color){const out=[];state.level.cells.forEach((c,i)=>{if(c===color&&!state.stitched.has(i))out.push(i)});return out}
 function lengths(state,color){return state.spools.filter(s=>s.color===color&&!s.done).map(s=>s.length).sort((a,b)=>b-a)}
 function legalNext(state,path,i,color){return cell(state.level,i)===color&&!state.stitched.has(i)&&!path.includes(i)&&(!path.length||neighbors(state.level,path[path.length-1]).includes(i))}

 // ---- path enumeration ----
 // all simple paths of exactly L cells that END at s (s is the first cell)
 function enumFrom(A,rem,s,L,cb){const vis=new Uint8Array(rem.length),path=[s];vis[s]=1;let stop=false;
  (function go(){if(stop)return;if(path.length===L){if(cb(path))stop=true;return}
   for(const n of A[path[path.length-1]])if(rem[n]&&!vis[n]){vis[n]=1;path.push(n);go();path.pop();vis[n]=0;if(stop)return}})()}
 // all simple paths of exactly L cells that CONTAIN c (two arms, shorter arm first => each undirected path once, except equal arms twice)
 function enumThrough(A,rem,c,L,cb){const vis=new Uint8Array(rem.length),armA=[],armB=[];vis[c]=1;let stop=false;
  const walkB=(last,need)=>{if(stop)return;if(!need){if(cb(armA.slice().reverse().concat(c,armB)))stop=true;return}
   for(const n of A[last])if(rem[n]&&!vis[n]){vis[n]=1;armB.push(n);walkB(n,need-1);armB.pop();vis[n]=0;if(stop)return}};
  const walkA=(last,a)=>{if(stop)return;const b=L-1-a;if(a<=b)walkB(c,b);if(a>=b)return;
   for(const n of A[last])if(rem[n]&&!vis[n]){vis[n]=1;armA.push(n);walkA(n,a+1);armA.pop();vis[n]=0;if(stop)return}};
  walkA(c,0)}

 // ---- exact per-color solver ----
 function canSum(n,lens){const ok=new Uint8Array(n+1);ok[0]=1;for(const l of lens)for(let v=n-l;v>=0;v--)if(ok[v])ok[v+l]=1;return !!ok[n]}
 function feasible(A,rem,cs,lens){const seen=new Set();for(const f of cs){if(seen.has(f))continue;let size=0;const q=[f];seen.add(f);for(let k=0;k<q.length;k++){size++;for(const y of A[q[k]])if(rem[y]&&!seen.has(y)){seen.add(y);q.push(y)}}if(!canSum(size,lens))return false}return true}
 function anchorOf(A,rem,cs){let best=cs[0],bd=9;for(const c of cs){let d=0;for(const j of A[c])if(rem[j])d++;if(d<bd){bd=d;best=c}}return best}
 const without=(ls,k)=>ls.slice(0,k).concat(ls.slice(k+1));
 // partition `cells` into simple paths whose lengths equal multiset `lens`
 function solveCells(w,h,cells,lens,limit=200000){
  const A=adj(w,h),rem=new Uint8Array(w*h);cells=[...cells].sort((a,b)=>a-b);lens=[...lens].sort((a,b)=>b-a);
  if(cells.length!==lens.reduce((a,b)=>a+b,0))return{status:'unsolvable',paths:null,nodes:0};
  cells.forEach(c=>rem[c]=1);let nodes=0,unknown=false;const out=[];
  function rec(ls){const cs=cells.filter(c=>rem[c]);if(!cs.length)return !ls.length;if(!ls.length)return false;
   const key=w+':'+cs.join(',')+'|'+ls.join(',');if(DEAD.has(key))return false;
   if(++nodes>limit){unknown=true;return false}
   if(!feasible(A,rem,cs,ls)){DEAD.add(key);return false}
   const anchor=anchorOf(A,rem,cs);let prev=-1;
   for(let k=0;k<ls.length;k++){const L=ls[k];if(L===prev)continue;prev=L;const next=without(ls,k);let found=false;
    enumThrough(A,rem,anchor,L,p=>{for(const i of p)rem[i]=0;out.push(p.slice());if(rec(next)){found=true;return true}out.pop();for(const i of p)rem[i]=1;return unknown});
    if(found)return true;if(unknown)return false}
   if(DEAD.size>DEAD_MAX)DEAD.clear();DEAD.add(key);return false}
  const ok=rec(lens);return{status:ok?'solvable':unknown?'unknown':'unsolvable',paths:ok?out:null,nodes}}
 function solveColor(state,color,o={}){return solveCells(state.level.w,state.level.h,remaining(state,color),lengths(state,color),o.limit??200000)}
 function solve(state,limit=200000){const all=[];for(const color of COLORS){const r=solveColor(state,color,{limit});if(r.status!=='solvable')return null;for(const path of r.paths)all.push({color,path})}return all}
 function isSolvable(state,limit=200000){let unknown=false;for(const color of COLORS){const s=solveColor(state,color,{limit}).status;if(s==='unsolvable')return'unsolvable';if(s==='unknown')unknown=true}return unknown?'unknown':'solvable'}

 // ---- start/commit analysis ----
 // for one spool: enumerate complete-length paths from each start; a path is "rejected" if the rest of the color becomes unsolvable
 function analyzeSpool(state,spool,pathCap,limit,firstOnly){
  const {level}=state,A=adj(level.w,level.h),cs=remaining(state,spool.color),rem=new Uint8Array(level.w*level.h);cs.forEach(c=>rem[c]=1);
  const lens=lengths(state,spool.color);lens.splice(lens.indexOf(spool.length),1);
  let total=0,rejected=0,unknown=false;const starts=[];
  for(const s of cs){let good=false;
   enumFrom(A,rem,s,spool.length,p=>{total++;for(const i of p)rem[i]=0;
    const r=solveCells(level.w,level.h,cs.filter(c=>rem[c]),lens,limit);for(const i of p)rem[i]=1;
    if(r.status==='unsolvable')rejected++;else{good=true;if(r.status==='unknown')unknown=true}
    return (firstOnly&&good)||total>=pathCap});
   if(good)starts.push(s);if(total>=pathCap)break}
  return{total,rejected,starts,unknown}}
 function validStarts(state,spool,limit=200000){return analyzeSpool(state,spool,Infinity,limit,true).starts}
 // ---- drawing assists (make "drawing the thread" easier) ----
 // 'ok' = some completion of this (partial) path commits cleanly; 'doomed' = every completion would tangle; 'unknown' = solver limit hit
 function pathStatus(state,spool,path,limit=GEN_NODE_LIMIT){
  if(!path.length)return'ok';
  const {level}=state,A=adj(level.w,level.h),cs=remaining(state,spool.color),rem=new Uint8Array(level.w*level.h);cs.forEach(c=>rem[c]=1);
  const lens=lengths(state,spool.color);lens.splice(lens.indexOf(spool.length),1);
  const vis=new Uint8Array(rem.length),p=path.slice();p.forEach(i=>vis[i]=1);let nodes=0,unknown=false;
  const go=()=>{if(p.length===spool.length){const r=solveCells(level.w,level.h,cs.filter(c=>!vis[c]),lens,limit);if(r.status==='unknown')unknown=true;return r.status!=='unsolvable'}
   if(++nodes>limit){unknown=true;return true}
   for(const n of A[p[p.length-1]])if(rem[n]&&!vis[n]){vis[n]=1;p.push(n);const r=go();p.pop();vis[n]=0;if(r)return true}return false};
  return go()?(unknown?'unknown':'ok'):'doomed'}
 // cells the thread can add by itself: while the head has exactly one legal neighbour there is no choice to make
 function autoRun(state,spool,path){const p=path.slice(),out=[];
  while(p.length<spool.length){const nx=neighbors(state.level,p[p.length-1]).filter(i=>legalNext(state,p,i,spool.color));if(nx.length!==1)break;p.push(nx[0]);out.push(nx[0])}
  return out}
 // a full path for `spool` that is part of a valid solution (booster: Auto-stitch)
 function autoStitch(state,spool,limit=200000){const r=solveColor(state,spool.color,{limit});return r.status==='solvable'?r.paths.find(p=>p.length===spool.length)||null:null}
 const ASSIST={warnUntilLevel:10}; // levels <= this show the 'doomed' warning for free; later it is a booster
 function rejectStats(level,pathCap,limit){const st=makeState(level);let legal=0,rejected=0,starts=0;
  for(const s of level.spools){const a=analyzeSpool(st,s,pathCap,limit,false);legal+=a.total;rejected+=a.rejected;starts+=a.starts.length/Math.max(1,remaining(st,s.color).length)}
  return{legal,rejected,rejectedRatio:legal?rejected/legal:0,startAmbiguity:level.spools.length?starts/level.spools.length:0}}
 // distinct partitions into the spool lengths, capped
 function countPartitions(w,h,cells,lens,cap=50,limit=20000){
  const A=adj(w,h),rem=new Uint8Array(w*h);cells.forEach(c=>rem[c]=1);let nodes=0;
  function rec(ls){const cs=cells.filter(c=>rem[c]);if(!cs.length)return ls.length?0:1;if(!ls.length)return 0;if(++nodes>limit)return cap;if(!feasible(A,rem,cs,ls))return 0;
   const anchor=anchorOf(A,rem,cs);let total=0,prev=-1;
   for(let k=0;k<ls.length;k++){const L=ls[k];if(L===prev)continue;prev=L;const next=without(ls,k),seen=new Set();
    enumThrough(A,rem,anchor,L,p=>{const f=p.join(),r=p.slice().reverse().join(),key=f<r?f:r;if(seen.has(key))return false;seen.add(key);
     for(const i of p)rem[i]=0;total+=rec(next);for(const i of p)rem[i]=1;return total>=cap});
    if(total>=cap)return cap}
   return total}
  return Math.min(cap,rec([...lens].sort((a,b)=>b-a)))}
 function metrics(level,cap=1500){const st=makeState(level),colors=[...new Set(level.cells.filter(x=>COLORS.includes(x)))],n=level.cells.filter(x=>COLORS.includes(x)).length;
  const r=rejectStats(level,cap,GEN_NODE_LIMIT);let solutions=1;
  for(const color of colors)solutions=Math.min(50,solutions*countPartitions(level.w,level.h,remaining(st,color),lengths(st,color),50,GEN_NODE_LIMIT));
  return{level:level.number,cells:n,colors:colors.length,spools:level.spools.length,startAmbiguity:+r.startAmbiguity.toFixed(2),rejectedRatio:+r.rejectedRatio.toFixed(2),solutions,botFail:+botSim(level,60,level.number).toFixed(2)}}

 // ---- difficulty bot ----
 // Models a player who can see dead ends (backtracks for free) but cannot foresee global solvability:
 // picks a random spool, finds some complete path by randomized DFS, commits, loses a heart if rejected.
 function randomPath(state,spool,rng){const {level}=state,A=adj(level.w,level.h),cs=remaining(state,spool.color),rem=new Uint8Array(level.w*level.h);cs.forEach(c=>rem[c]=1);
  for(let i=cs.length-1;i>0;i--){const j=rng()*(i+1)|0;[cs[i],cs[j]]=[cs[j],cs[i]]}
  for(const s of cs){const vis=new Uint8Array(rem.length),path=[s];vis[s]=1;let steps=0;
   const go=()=>{if(path.length===spool.length)return true;if(++steps>3000)return false;const nx=A[path[path.length-1]].filter(n=>rem[n]&&!vis[n]);
    for(let i=nx.length-1;i>0;i--){const j=rng()*(i+1)|0;[nx[i],nx[j]]=[nx[j],nx[i]]}
    for(const n of nx){vis[n]=1;path.push(n);if(go())return true;path.pop();vis[n]=0}return false};
   if(go())return path}
  return null}
 function botSim(level,runs=40,seed=1,hearts=3,limit=GEN_NODE_LIMIT){const rng=mulberry32(seed);let fails=0;
  for(let r=0;r<runs;r++){const spools=level.spools.map(s=>({...s,done:false})),st=makeState(level,new Set(level.prestitch),spools);let h=hearts;
   while(h>0&&spools.some(s=>!s.done)){const open=spools.filter(s=>!s.done),sp=open[rng()*open.length|0],path=randomPath(st,sp,rng);
    if(!path){h--;continue}
    path.forEach(i=>st.stitched.add(i));sp.done=true;
    if(solveColor(st,sp.color,{limit}).status==='unsolvable'){path.forEach(i=>st.stitched.delete(i));sp.done=false;h--}}
   if(h<=0)fails++}
  return fails/runs}

 // ---- levels ----
 const FIXTURE={name:'First Stitch',rows:['RRRG','RGGG','RRGG'],spools:[{color:'R',length:6},{color:'G',length:6}]};
 const rings=(w,f)=>Array.from({length:w},(_,r)=>Array.from({length:w},(_,c)=>f(r,c)).join(''));
 const MOTIFS=[ // levels 2..20; R coral, G leaf, B sky, Y sunflower, V violet, P pink, '.' bare fabric
  ['Flower',['.PPP.','PPYPP','PPYPP','.PPP.','..G..','..G..']],
  ['Mushroom',['.RRRR.','RPRRPR','RPRRPR','..YY..','..YY..']],
  ['Jewel',['.RRR.','RPPPR','RPPPR','.RRR.']],
  ['Fish',['.BBB.Y','BBVBBY','BBVBBY','.BBB.Y']],
  ['House',['..RR..','.RRRR.','RRRRRR','YYBBYY','YYBBYY','YYVVYY']],
  ['Star',['..PP..','..YY..','YYRRYY','YYRRYY','.YYYY.','.Y..Y.']],
  ['Cat',['RR...RR','RRRRRRR','RVRRRVR','RVRRRVR','RRRPPRR','.RRRRR.']],
  ['Butterfly',['VVV.VVV','VPPRPPV','VVVRVVV','.VVRVV.','..V.V..']],
  ['Sunflower',['..YYY..','.YYYYY.','YYVVVYY','YYVVVYY','.YYYYY.','..YYY..','...G...','...G...']],
  ['Lotus',['...PP...','..PPPP..','.PPVVPP.','PPPVVPPP','.PPPPPP.','GGGGGGGG'],{pre:.2}],   // optional 3rd item overrides the tier config (more anchors = smaller regions)
  ['Owl',['B.BBBB.B','BBBBBBBB','BYYBBYYB','RYYRRYYR','RRRPPRRR','.RRRRRR.','..VV.VV.']], // two-tone body keeps each region <= ~18 cells
  ['Teapot',['...YY...','.RRRRRR.','VRRPPRRV','VRRPPRRV','.RRRRRR.','..RRRR..']],
  ['Moon',['..YYYY..','.YYY.PP.','YYY.....','YYY..VV.','YYY.....','.YYY.PP.','..YYYY..']],
  ['Cherry',['.GGGGGG.','.G....G.','.G....G.','RRR..RRR','RPR..RPR','RPR..RPR','RRR..RRR']],
  ['Gem',['...RR...','..RRRR..','.RRPPRR.','RRRPPRRR','VVVYYVVV','.VVYYVV.','..VVVV..','...VV...']],
  ['Tree',['....G....','...GGG...','..GYYGG..','...GGG...','..GPPGG..','.GBBGGGG.','GGVVGGGVV','...RRR...','...RRR...']],
  // L18-20: many small same-colour regions (difficulty ~ size of a region that must be split across spools)
  ['Patchwork',rings(9,(r,c)=>['YRP','BVG','PYR'][r/3|0][c/3|0])],              // 3x3 blocks, neighbours always differ
  ['Rainbow',rings(10,(r,c)=>'YRPBV'[r>>1])],                                   // five 2x10 stripes
  ['Mosaic',rings(10,(r,c)=>'YRPBVG'[((c>>1)+2*(r>>2>0?1:0))%6])]];             // ten 2x5 / 2x4 tiles
 function parseLevel(name,rows,number){const w=Math.max(...rows.map(r=>r.length)),cells=[];for(const row of rows)for(let c=0;c<w;c++){const ch=row[c]||'.';cells.push(COLORS.includes(ch)||ch==='#'?ch:'.')}
  return{number,name,w,h:rows.length,cells,spools:[],solution:[],prestitch:new Set()}}
 // randomized self-avoiding walks (Warnsdorff-style) that tile one color's cells; null if min length cannot be met
 function partition(A,cellsArr,rng,cfg){
  const n=cellsArr.length,kmax=Math.max(1,Math.min(cfg.kmax,n/cfg.prefLen|0)),kmin=Math.min(cfg.kmin,kmax);let best=null,bestScore=1e9;
  for(let t=0;t<80&&bestScore>0;t++){
   const lo=Math.ceil(n/kmax),hi=Math.ceil(n/kmin),maxLen=kmax===1?n:lo+Math.floor(rng()*(hi-lo+1)),left=new Set(cellsArr),paths=[];
   const deg=c=>{let d=0;for(const j of A[c])if(left.has(j))d++;return d};
   const pickMin=(list)=>{let m=9;for(const c of list)m=Math.min(m,deg(c));const ties=list.filter(c=>deg(c)===m);return ties[Math.floor(rng()*ties.length)]};
   while(left.size){let cur=pickMin([...left]);left.delete(cur);const p=[cur];
    while(p.length<maxLen){const nx=A[cur].filter(j=>left.has(j));if(!nx.length)break;
     cur=rng()<.15?nx[Math.floor(rng()*nx.length)]:pickMin(nx);left.delete(cur);p.push(cur)}
    paths.push(p)}
   const k=paths.length,bad=paths.filter(p=>p.length<cfg.minLen).length,eq=k>1&&paths.every(p=>p.length===paths[0].length);
   const soft=paths.filter(p=>p.length<cfg.prefLen).length;
   const score=bad*1000+soft*20+Math.max(0,kmin-k,k-kmax)*10+(eq?5:0);if(score<bestScore){bestScore=score;best=paths}}
  return bestScore>=1000?null:best}
 function buildCandidate(n,name,rows,cand,cfg,anchors){
  const level=parseLevel(name,rows,n),rng=mulberry32(n*7919+cand*131+7),A=adj(level.w,level.h);
  const colored=()=>level.cells.map((x,i)=>COLORS.includes(x)?i:-1).filter(i=>i>=0);
  const take=k=>{const pool=colored();for(let t=0;t<k&&pool.length;t++)yield_(pool.splice(Math.floor(rng()*pool.length),1)[0])};
  let mode='torn';const yield_=i=>{if(mode==='torn')level.cells[i]='#';else{level.prestitch.add(i);level.cells[i]=level.cells[i].toLowerCase()}};
  if(anchors&&cfg.torn)take(cfg.torn);
  mode='pre';if(anchors&&cfg.pre)take(Math.round(colored().length*cfg.pre));
  let id=0;
  for(const color of COLORS){const cs=level.cells.map((x,i)=>x===color?i:-1).filter(i=>i>=0);if(!cs.length)continue;
   const kneed=cfg.maxLen?Math.ceil(cs.length/cfg.maxLen):0,paths=partition(A,cs,rng,kneed?{...cfg,kmin:Math.max(cfg.kmin,kneed),kmax:Math.max(cfg.kmax,kneed+1)}:cfg);if(!paths)return null;
   paths.sort((a,b)=>b.length-a.length);for(const path of paths){level.spools.push({id:id++,color,length:path.length,done:false});level.solution.push({color,path})}}
  return level}
 function generateLevels(){
  const levels=[parseLevel(FIXTURE.name,FIXTURE.rows,1)];levels[0].spools=FIXTURE.spools.map((s,id)=>({...s,id,done:false}));levels[0].solution=solve(makeState(levels[0]))||[];
  for(let n=2;n<=20;n++){const [name,rows,extra]=MOTIFS[n-2],cfg={...DIFFICULTY.find(t=>n<=t.to),...extra};levels.push(bestLevel(n,name,rows,cfg,n))}
  return levels}
 // best of cfg.cands random partitions; tn = "difficulty level number" that drives the bot-fail target
 function bestLevel(n,name,rows,cfg,tn){let best=null,bestScore=Infinity;
  for(const anchors of [true,false]){ // fall back to a plain level if anchors/holes make a color too small
   for(let cand=0;cand<cfg.cands;cand++){const lv=buildCandidate(n,name,rows,cand,cfg,anchors);if(!lv)continue;
    const fail=botSim(lv,cfg.botRuns||GEN_BOT_RUNS,n*31+cand),target=failTarget(tn);
    const score=tn<=5?lv.spools.length*10+fail*100 // early: fewest spools, bot never fails
     :Math.abs(fail-target)*100;                    // later: bot fail rate close to the curve
    if(score<bestScore){bestScore=score;best=lv}}
   if(best)break}
  if(!best)throw Error('cannot generate level '+n+' '+name);return best}

 // ---- reject / region analysis (UX: explain why a heart was lost) ----
 // connected size of the unstitched same-colour area containing cell i
 function regionSize(state,color,i){const A=adj(state.level.w,state.level.h),seen=new Set([i]),q=[i];
  for(let k=0;k<q.length;k++)for(const j of A[q[k]])if(!seen.has(j)&&state.level.cells[j]===color&&!state.stitched.has(j)){seen.add(j);q.push(j)}
  return seen.size}
 // after a spool is committed: which remaining cells of that colour can no longer be finished?
 function strandInfo(state,color){const {level}=state,A=adj(level.w,level.h),cs=remaining(state,color),lens=lengths(state,color),rem=new Uint8Array(level.w*level.h);
  cs.forEach(c=>rem[c]=1);const seen=new Set(),bad=[];
  for(const f of cs){if(seen.has(f))continue;const comp=[f];seen.add(f);
   for(let k=0;k<comp.length;k++)for(const y of A[comp[k]])if(rem[y]&&!seen.has(y)){seen.add(y);comp.push(y)}
   if(!canSum(comp.length,lens))bad.push(comp)}
  if(bad.length)return{kind:lens.length?'size':'nospool',cells:bad.flat(),sizes:bad.map(b=>b.length),lens};
  return{kind:'shape',cells:cs,sizes:[cs.length],lens}}

 // ---- tapestries: big pictures cut into 8x8 pieces; each piece is a normal level ----
 function canvasGrid(w,h){const g=Array.from({length:h},()=>Array(w).fill('.'));
  const each=(f)=>{for(let y=0;y<h;y++)for(let x=0;x<w;x++)f(x,y)},put=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<w&&y<h)g[y][x]=c};
  const inPoly=(x,y,p)=>{let o=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])o=!o;return o};
  return{put,w,h,
   rect:(x,y,rw,rh,c)=>{for(let j=0;j<rh;j++)for(let i=0;i<rw;i++)put(x+i,y+j,c)},
   disc:(cx,cy,r,c)=>each((x,y)=>{if((x-cx)**2+(y-cy)**2<=r*r)g[y][x]=c}),
   ring:(cx,cy,r,t,c)=>each((x,y)=>{const d=Math.hypot(x-cx,y-cy);if(d<=r&&d>r-t)g[y][x]=c}),
   ell:(cx,cy,rx,ry,c)=>each((x,y)=>{if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)g[y][x]=c}),
   poly:(p,c)=>each((x,y)=>{if(inPoly(x,y,p))g[y][x]=c}),
   trail:(pts,rad,c)=>{for(let s=0;s<pts.length-1;s++)for(let t=0;t<=1;t+=.1){const x=pts[s][0]+(pts[s+1][0]-pts[s][0])*t,y=pts[s][1]+(pts[s+1][1]-pts[s][1])*t,r=rad[s]+(rad[s+1]-rad[s])*t;each((px,py)=>{if((px-x)**2+(py-y)**2<=r*r)g[py][px]=c})}},
   bg:(y0,y1,c)=>{for(let y=y0;y<=y1&&y<h;y++)for(let x=0;x<w;x++)if(g[y][x]==='.')g[y][x]=c},
   rows:()=>g.map(r=>r.join(''))}}
 const ART={
  cottage(){const g=canvasGrid(16,16);
   g.rect(1,1,5,1,'B');g.rect(2,2,3,1,'B');g.disc(12,3,2,'Y');
   g.rect(10,4,2,4,'N');g.poly([[1,8.5],[7,3],[13,8.5]],'R');g.rect(2,9,10,4,'O');
   g.rect(6,10,2,3,'N');g.rect(3,10,2,2,'B');g.rect(9,10,2,2,'B');
   g.rect(14,10,2,3,'N');g.disc(14.5,8,2,'G');
   g.rect(0,13,16,3,'G');g.rect(1,13,2,1,'P');g.rect(12,14,2,1,'V');g.rect(5,15,2,1,'Y');return g.rows()},
  fox(){const g=canvasGrid(24,16);
   g.disc(19,3,2.6,'Y');g.rect(3,1,2,1,'Y');g.rect(9,3,2,1,'Y');g.rect(13,1,2,1,'Y');g.rect(10,6,2,1,'Y');
   g.ell(12,14,13,3,'G');g.rect(0,13,24,3,'G');
   g.poly([[0,11],[4,4],[8,11]],'T');g.rect(4,11,1,2,'N');g.poly([[16,11],[20,6],[24,11]],'T');g.rect(20,11,1,2,'N');
   g.poly([[7.5,11],[4,8],[5,13.5]],'O');g.rect(4,9,1,2,'P');g.ell(11,11,4,2.2,'O');g.disc(15.5,9,2,'O');
   g.poly([[14,6],[15,8.5],[13,8]],'R');g.poly([[17,6],[18,8],[16,8.5]],'R');g.rect(17,10,2,1,'K');g.rect(16,8,1,1,'K');return g.rows()},
  koi(){const g=canvasGrid(24,24);
   g.ring(6,6,5.4,1.2,'T');g.ring(18,18,5.6,1.2,'T');
   g.disc(18,6,3,'G');g.disc(18,6,1.4,'P');g.rect(18,6,2,1,'V');g.disc(5,19,2.6,'G');g.rect(4,19,2,1,'T');g.rect(20,5,2,1,'T');
   g.trail([[5,10],[9,9],[13,11],[16,15],[17,19]],[2.2,2.5,2.1,1.6,1],'O');g.trail([[17,19],[19,22]],[1.1,1.8],'R');g.rect(7,8,2,2,'R');g.rect(6,10,1,1,'K');
   g.trail([[3,14],[6,15],[9,14],[12,18],[11,22]],[1.5,1.8,1.6,1.3,.9],'Y');g.rect(7,14,2,1,'P');g.rect(3,14,1,1,'K');
   return g.rows()}};
 const TAP=[
  {id:'cottage',name:'Cottage Garden',short:'Cottage',w:16,h:16,cfg:{minLen:1,prefLen:3,kmin:1,kmax:1,pre:.08,torn:0,cands:30,maxLen:16,botRuns:16,tn:8}},
  {id:'fox',name:'Fox at Night',short:'Fox',w:24,h:16,cfg:{minLen:1,prefLen:3,kmin:1,kmax:1,pre:.08,torn:0,cands:30,maxLen:16,botRuns:16,tn:12}},
  {id:'koi',name:'Koi Pond',short:'Koi',w:24,h:24,cfg:{minLen:1,prefLen:3,kmin:1,kmax:1,pre:.1,torn:0,cands:30,maxLen:16,botRuns:16,tn:17}}];
 const PIECE=8;
 // tiny leftovers (components < minLen inside a piece) are merged into a neighbouring colour or dropped, so every piece is a valid puzzle
 function tidy(rows,pw,ph,minLen=2){const g=rows.map(r=>r.split('')),h=g.length,w=g[0].length,A=adj(w,h);
  for(let py=0;py<h;py+=ph)for(let px=0;px<w;px+=pw){const inP=i=>{const x=i%w,y=i/w|0;return x>=px&&x<px+pw&&y>=py&&y<py+ph},seen=new Set();
   for(let y=py;y<py+ph;y++)for(let x=px;x<px+pw;x++){const i=y*w+x,c=g[y][x];if(!COLORS.includes(c)||seen.has(i))continue;
    const comp=[i];seen.add(i);for(let k=0;k<comp.length;k++)for(const j of A[comp[k]])if(inP(j)&&!seen.has(j)&&g[j/w|0][j%w]===c){seen.add(j);comp.push(j)}
    if(comp.length>=minLen)continue;const cnt={};for(const a of comp)for(const j of A[a])if(inP(j)){const d=g[j/w|0][j%w];if(COLORS.includes(d)&&d!==c)cnt[d]=(cnt[d]||0)+1}
    const best=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0]||'.';for(const a of comp)g[a/w|0][a%w]=best}}
  return g.map(r=>r.join(''))}
 // oversized single-colour areas are split into two shades (alt colour) so every area stays a fair puzzle
 const ALT={G:'T',T:'G',B:'T',O:'Y',Y:'O',R:'P',P:'R',V:'K',K:'V',N:'O'};
 function shade(rows,pw,ph,max=16){const g=rows.map(r=>r.split('')),h=g.length,w=g[0].length,A=adj(w,h);
  for(let pass=0;pass<8;pass++){let changed=false;
   for(let py=0;py<h;py+=ph)for(let px=0;px<w;px+=pw){const inP=i=>{const x=i%w,y=i/w|0;return x>=px&&x<px+pw&&y>=py&&y<py+ph},at=i=>g[i/w|0][i%w],seen=new Set();
    const bfs=(s,c)=>{const dist=new Map([[s,0]]),q=[s];for(let k=0;k<q.length;k++)for(const j of A[q[k]])if(inP(j)&&!dist.has(j)&&at(j)===c){dist.set(j,dist.get(q[k])+1);q.push(j)}return{dist,q}};
    for(let y=py;y<py+ph;y++)for(let x=px;x<px+pw;x++){const i=y*w+x,c=g[y][x];if(!COLORS.includes(c)||seen.has(i))continue;
     const a=bfs(i,c);a.q.forEach(j=>seen.add(j));if(a.q.length<=max)continue;
     const far=a.q[a.q.length-1],b=bfs(far,c),half=b.q.length>>1,alt=ALT[c];b.q.slice(0,half).forEach(j=>{g[j/w|0][j%w]=alt});changed=true}}
   if(!changed)break}
  return g.map(r=>r.join(''))}
 function makePictures(first=21){let n=first;return TAP.map(p=>{const rows=tidy(shade(tidy(ART[p.id](),PIECE,PIECE,2),PIECE,PIECE,p.cfg.region||16),PIECE,PIECE,2),cols=p.w/PIECE,count=cols*(p.h/PIECE),firstNo=n;n+=count;
   const piece=i=>{const px=i%cols*PIECE,py=(i/cols|0)*PIECE;return rows.slice(py,py+PIECE).map(r=>r.slice(px,px+PIECE))};
   return{...p,rows,cols,count,first:firstNo,piece}})}
 function generateTapestry(first=21){const out=[];
  for(const pic of makePictures(first))for(let i=0;i<pic.count;i++){const n=pic.first+i,lv=bestLevel(n,pic.name+' '+(i+1)+'/'+pic.count,pic.piece(i),pic.cfg,pic.cfg.tn);
   const bf=botSim(lv,40,n*13);Object.assign(lv,{botFail:+bf.toFixed(2),hearts:bf>.8?5:bf>.5?4:3,pic:pic.id,picName:pic.name,picShort:pic.short,piece:i,pieces:pic.count,px:i%pic.cols,py:i/pic.cols|0,cols:pic.cols});out.push(lv)}
  return out}

 return{COLORS,regionSize,strandInfo,canvasGrid,makePictures,generateTapestry,tidy,DIFFICULTY,mulberry32,makeState,neighbors,cell,remaining,lengths,solveCells,solveColor,solve,isSolvable,legalNext,validStarts,analyzeSpool,countPartitions,botSim,failTarget,pathStatus,autoRun,autoStitch,ASSIST,FIXTURE,MOTIFS,parseLevel,generateLevels,metrics};
})();
