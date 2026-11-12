const Logic=(()=>{
 // Pure game logic (no DOM). Source of truth; `node build.js` splices it into index.html.
 const COLORS='RGBYVPONTKC'; // R coral, G leaf, B sky, Y sunflower, V violet, P pink, O orange, N brown, T teal, K charcoal, C ivory
 const DIFFICULTY=[ // tunable: spools per color (kmin..kmax), min spool length, anchors/holes, candidates tried
  {to:5, minLen:2,prefLen:2,kmin:1,kmax:1,pre:0,   torn:0,cands:6},
  {to:15,minLen:2,prefLen:2,kmin:1,kmax:2,pre:.12, torn:0,cands:40,botRuns:16},  // spec says 2-3 spools/color; bot showed that is too trap-heavy
  {to:20,minLen:1,prefLen:2,kmin:1,kmax:1,pre:.12, torn:3,cands:40,botRuns:16}]; // spec 3-5; bot: >1 spool per region is brutal. L16+ may use 1-cell spools but they are penalised
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
 // Naive random player, same rules as the game: pick a spool, drag any complete path. No path for that spool = dead end (the game only
 // asks for a stitch back, no heart). A heart is lost only when a committed path leaves its colour unsolvable (closed shape that strands cells).
 function botSim(level,runs=40,seed=1,hearts=3,limit=GEN_NODE_LIMIT){const rng=mulberry32(seed);let fails=0;
  for(let r=0;r<runs;r++){const spools=level.spools.map(s=>({...s,done:false})),st=makeState(level,new Set(level.prestitch),spools),tried=new Set();let h=hearts,stuck=false;
   while(h>0&&spools.some(s=>!s.done)){const open=spools.filter(s=>!s.done&&!tried.has(s.id));
    if(!open.length){stuck=true;break}
    const sp=open[rng()*open.length|0],path=randomPath(st,sp,rng);
    if(!path){tried.add(sp.id);continue}
    tried.clear();path.forEach(i=>st.stitched.add(i));sp.done=true;
    if(solveColor(st,sp.color,{limit}).status==='unsolvable'){path.forEach(i=>st.stitched.delete(i));sp.done=false;h--}}
   if(h<=0||stuck)fails++}
  return fails/runs}


 // ---- human cognitive simulation ----
 function humanPath(state,spool,persona,rng){const {level}=state,A=adj(level.w,level.h),cs=remaining(state,spool.color);
  if(!cs.length)return null;const rem=new Uint8Array(level.w*level.h);cs.forEach(c=>rem[c]=1);
  const deg=new Int32Array(level.w*level.h);
  cs.forEach(c=>{let d=0;for(const n of A[c])if(rem[n])d++;deg[c]=d});
  const starts=cs.slice();
  starts.sort((a,b)=>{
   const wA=(persona==='pro')?(deg[a]===1?-100:deg[a]):(persona==='regular')?(deg[a]===1?-50:deg[a]):(rng()*10);
   const wB=(persona==='pro')?(deg[b]===1?-100:deg[b]):(persona==='regular')?(deg[b]===1?-50:deg[b]):(rng()*10);
   return wA-wB;
  });
  for(const s of starts){
   const vis=new Uint8Array(rem.length),path=[s];vis[s]=1;let steps=0;
   const go=()=>{
    if(path.length===spool.length)return true;
    if(++steps>2500)return false;
    const head=path[path.length-1],prev=path.length>1?path[path.length-2]:-1;
    const nx=A[head].filter(n=>rem[n]&&!vis[n]);
    if(!nx.length)return false;
    nx.sort((a,b)=>{
     let scoreA=rng()*2,scoreB=rng()*2;
     let exitsA=0,exitsB=0;
     for(const na of A[a])if(rem[na]&&!vis[na])exitsA++;
     for(const nb of A[b])if(rem[nb]&&!vis[nb])exitsB++;
     if(persona==='pro'){scoreA+=exitsA*3;scoreB+=exitsB*3}
     else if(persona==='regular'){scoreA+=exitsA*1.5;scoreB+=exitsB*1.5}
     if(prev!==-1){
      const dirX=(head%level.w)-(prev%level.w),dirY=(head/level.w|0)-(prev/level.w|0);
      const nDirAx=(a%level.w)-(head%level.w),nDirAy=(a/level.w|0)-(head/level.w|0);
      const nDirBx=(b%level.w)-(head%level.w),nDirBy=(b/level.w|0)-(head/level.w|0);
      if(nDirAx===dirX&&nDirAy===dirY)scoreA-=2;
      if(nDirBx===dirX&&nDirBy===dirY)scoreB-=2;
     }
     if(persona==='casual'){scoreA+=rng()*4;scoreB+=rng()*4}
     return scoreA-scoreB;
    });
    for(const n of nx){
     if(persona!=='casual'){
      let strandsNeighbor=false;
      for(const neighbor of A[head]){
       if(rem[neighbor]&&!vis[neighbor]&&neighbor!==n){
        let avail=0;
        for(const nn of A[neighbor])if(rem[nn]&&!vis[nn]&&nn!==n)avail++;
        if(avail===0&&path.length+1<spool.length){strandsNeighbor=true;break}
       }
      }
      if(strandsNeighbor&&rng()>0.15)continue;
     }
     vis[n]=1;path.push(n);
     if(go())return true;
     path.pop();vis[n]=0;
    }
    return false;
   };
   if(go())return path;
  }
  return null;
 }

 function humanSim(level,o={}){
  const runs=o.runs||25,hearts=o.hearts??3,personas=['casual','regular','pro'];
  const results={},heatmap=new Int32Array(level.w*level.h);
  for(const p of personas){
   const rng=mulberry32((o.seed||1)*31+p.charCodeAt(0));
   let wins=0,totalHeartsLost=0;
   for(let r=0;r<runs;r++){
    const spools=level.spools.map(s=>({...s,done:false})),st=makeState(level,new Set(level.prestitch),spools);
    let h=hearts,stuck=false;const tried=new Set();
    while(h>0&&spools.some(s=>!s.done)){
     const open=spools.filter(s=>!s.done&&!tried.has(s.id));
     if(!open.length){stuck=true;break}
     let sp;
     if(p==='pro'||p==='regular'){
      open.sort((a,b)=>b.length-a.length);
      sp=(rng()<0.7)?open[0]:open[rng()*open.length|0];
     }else{
      sp=open[rng()*open.length|0];
     }
     const path=humanPath(st,sp,p,rng);
     if(!path){tried.add(sp.id);continue}
     tried.clear();
     path.forEach(i=>st.stitched.add(i));sp.done=true;
     const sol=solveColor(st,sp.color,{limit:5000});
     if(sol.status==='unsolvable'){
      path.forEach(i=>heatmap[i]++);
      path.forEach(i=>st.stitched.delete(i));sp.done=false;h--;totalHeartsLost++;
     }
    }
    if(h>0&&!stuck&&spools.every(s=>s.done))wins++;
   }
   results[p]={winRate:+(wins/runs).toFixed(2),avgHeartsLost:+(totalHeartsLost/runs).toFixed(2)};
  }
  const A=adj(level.w,level.h);
  let junctionCells=0,totalColored=0;
  level.cells.forEach((c,idx)=>{
   if(c!=='.'&&COLORS.includes(c)){
    totalColored++;let sameNeighbors=0;
    for(const n of A[idx])if(level.cells[n]===c)sameNeighbors++;
    if(sameNeighbors>=3)junctionCells++;
   }
  });
  const ambiguityScore=totalColored?+(junctionCells/totalColored).toFixed(2):0;
  const estSeconds=Math.round(totalColored*1.2+junctionCells*5+level.spools.length*4);
  return{personas:results,ambiguityScore,junctionCells,totalColored,estSeconds,heatmap:Array.from(heatmap)};
 }
 // ---- levels ----
 const MINI_OVERRIDES = {};
 function buildMiniOverride(number, data) {
  const {name, rows, spools, difficultyLabel, palette} = data;
  if (!Number.isInteger(number) || number < 1 || number > 20) throw Error('Invalid mini-level number');
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[<"]/.test(name)) throw Error('Invalid level name');
  if (!Array.isArray(rows) || !rows.length || rows.length > 64 ||
      !rows.every(row => typeof row === 'string' && row.length === rows[0].length && row.length > 0 && row.length <= 64 &&
        [...row].every(c => c === '.' || c === '#' || COLORS.includes(c.toUpperCase())))) throw Error('Invalid mini-level grid');
  if (difficultyLabel != null && !['easy','medium','hard'].includes(difficultyLabel)) throw Error('Invalid difficulty label');
  if (typeof spools !== 'string' || !spools.trim().split(/\s+/).every(token => /^[A-Z][1-9]\d{0,3}$/.test(token) && COLORS.includes(token[0]))) {
   throw Error('Invalid spools. Split the level before saving.');
  }
  const level = parseLevel(name, rows.map(row => row.toUpperCase()), number);
  [...rows.join('')].forEach((c,i) => {
   if (COLORS.includes(c.toUpperCase()) && c !== c.toUpperCase()) {
    level.cells[i] = c;
    level.prestitch.add(i);
   }
  });
  level.spools = spools.trim().split(/\s+/).map((token,id) => ({id,color:token[0],length:+token.slice(1),done:false}));
  const solution = solve(makeState(level));
  if (!solution) throw Error('Spools do not cover the level. Split the level again before saving.');
  level.solution = solution;
  if (palette != null && (typeof palette !== 'object' || Array.isArray(palette) ||
      Object.entries(palette).some(([key,value]) => key.length !== 1 || !COLORS.includes(key) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)))) throw Error('Invalid level palette');
  level.palette = palette;
  level.difficultyLabel = difficultyLabel;
  return level;
 }
 function applyMiniOverride(source, number, data) {
  buildMiniOverride(number, data);
  const marker = /^ const MINI_OVERRIDES = (\{[^\r\n]*\});$/m;
  const match = source.match(marker);
  if (!match) throw Error('This logic.js does not support mini-level overrides');
  const overrides = JSON.parse(match[1]);
  overrides[number] = data;
  const json = JSON.stringify(overrides).replaceAll('<', '\\u003c');
  return source.replace(marker, () => ' const MINI_OVERRIDES = ' + json + ';');
 }
 const FIXTURE={name:'First Stitch',rows:['RRRG','RGGG','RRGG'],spools:[{color:'R',length:6},{color:'G',length:6}]};
 const MOTIFS=[ // Levels 2-20. Floss colours use COLORS, '.' is bare fabric and '#' is a tear.
  ['Flower',['..PP..','.PPPP.','PPYYPP','PPYYPP','.PPPP.','..GGG.','..G...']],
  ['Toadstool',['..RRRR..','.RRRRRR.','RRCCRRRR','RRCCRRRR','.RRRRRR.','..KKKK..','..CCCC..','..CCCC..']],
  ['Round Cactus',['..GG..','.GGGG.','GGTTGG','GGTTGG','.OOOO.','..OO..','..OO..']],
  ['Acorn',['..NN..','..NN..','.NNNN.','.NNNN.','.OOOO.','.OOOO.','..OO..']],
  ['Blue Shark',['....BB.....','...BBB.....','.BBBBBBB.TT','BBKKBBBBTTT','CCKKCCCCCTT','.CCCCCCC...','....CC.....'],{pre:.08}],
  ['Potted Poppy',['..RR...','.RRRR..','.ROOR..','..GG...','.GGGTT.','GGGTTT.','..GG...','.OOOOO.','..NNN..','..NNN..'],{pre:.08}],
  ['Longneck',['.TTTT....','.TTTT....','.GGKKG...','.GGGGG...','.GG......','.GGYY....','.GGYYGG..','.TTTTTTT.','..TTTTTT.','..TT.TT..'],{pre:.08}],
  ['Desert Cactus',['...GG...','...GG...','.T.GG.G.','TT.GG.GG','TTGGGGGG','.TGGGGG.','...GG...','.OOOOOO.','..NNNN..','..NNNN..'],{pre:.08}],
  ['Pink Camellia',['..PPPP..','.PPPPPP.','PPPPPPPP','PPPCCPPP','PPPPPPPP','.PPPPPP.','..PPPP..','...GG...'],{difficultyLabel:'hard',bakedSpools:'P16 P14 P12 C2 G2'}],
  ['Honey Jar',['..NNNN..','.NNNNNN.','.YYYYYY.','.YYYYYY.','OOOCCOOO','OOOCCOOO','.YYYYYY.','.YYYYYY.','..NNNN..'],{pre:.08}],
  ['Hanging Ivy',['...NN...','..NNNN..','.NN..NN.','NN....NN','GGTTTTGG','GGTTTTGG','.GTTTTG.','.OOCCOO.','.OOCCOO.','..OOOO..'],{pre:.24}],
  ['Ladybug',['...KK...','..KKKK..','.RRKKRR.','RRRKKRRR','ROOKKOOR','ROOKKOOR','.OOKKOO.','..KKKK..'],{pre:.24}],
  ['Siamese',['KK....KK..','KNNNNNNK..','.NNNNNN...','.NBBNBB...','.NNNNNN...','.CCCCCC.NN','.CCCCCC.NN','.CCCCCCNN.','.NNCCNNN..'],{pre:.04}],
  ['Potted Tulip',['..RR.RR..','..RRRRR..','..RPPRR..','...PP....','...GG....','.TTGGTT..','TTTGGTTT.','.TTGGTT..','.OOOOOOO.','..ONNNO..','..ONNNO..','...NNN...'],{pre:.08}],
  ['Leafy Fern',['......GG..','.TT..GGG..','..TT.GG...','..TTTGG...','.TTTTGGGG.','..TTTGGGGG','...TTGGGG.','...OOOO...','..OOOOOO..','...NNNN...','#..NNNN..#','....#.....'],{torn:0,pre:.20}],
  ['Garden Snail',['...NNN....','..NNNNN...','.NNOOONN..','.NNOOONN..','.NNOOON.GG','..NNNN.GKK','#TTTTTTGGG','TTTTTTGGG.','.GGGGGGG.#','..GGGG.#..'],{torn:0,pre:.16}],
  ['Flower Basket',['..CC..PP..','.CCCCPPPP.','.CCCCPPPP.','..OOOOOO..','.OOOOOOOO.','.OONNOOOO.','.OOOOOOOO.','..OONOOO..','..OOOOOO..','...OOOO...'],{difficultyLabel:'hard',bakedSpools:'O18 O15 O10 C10 P10 N2 N1'}],
  ['Watering Can',['......GG..','.....GGGG.','..TT.GG.GG','.TTT.GG.GG','TTTTBBBBG.','.TTTBBBB..','.TTTBBBBB.','#..BBBBBB.','...BBBBBB#','...TTTT#..'],{torn:0,pre:.04}],
  ['Terrarium',['...NNNN...','..NNNNNN..','.TTTTTTTT.','.TTTTTTTT.','.TTGGTTTT.','.TTGGTTTT.','.TTTTTTTT.','.TTTTTTTT.','..NNNNNN..','...NNNN...'],{difficultyLabel:'hard',bakedSpools:'T25 T11 T8 N10 N10 G4'}]];
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
  const levels=[parseLevel(FIXTURE.name,FIXTURE.rows,1)];levels[0].difficultyLabel=FIXTURE.difficultyLabel;levels[0].spools=FIXTURE.spools.map((s,id)=>({...s,id,done:false}));levels[0].solution=solve(makeState(levels[0]))||[];
  for(let n=2;n<=20;n++){const [name,rows,extra]=MOTIFS[n-2],cfg={...DIFFICULTY.find(t=>n<=t.to),...extra};const level=extra?.bakedSpools ? levelFromBaked(n,name,rows,extra.bakedSpools) : bestLevel(n,name,rows,cfg,n);level.difficultyLabel=extra?.difficultyLabel;levels.push(level)}
  for (const [number, data] of Object.entries(MINI_OVERRIDES)) levels[+number-1] = buildMiniOverride(+number, data);
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
  cs.forEach(c=>rem[c]=1);const seen=new Set(),bad=[],groups=[];
  for(const f of cs){if(seen.has(f))continue;const comp=[f];seen.add(f);
   for(let k=0;k<comp.length;k++)for(const y of A[comp[k]])if(rem[y]&&!seen.has(y)){seen.add(y);comp.push(y)}
   groups.push(comp);if(!canSum(comp.length,lens))bad.push(comp)}
  if(bad.length)return{kind:lens.length?'size':'nospool',cells:bad.flat(),sizes:bad.map(b=>b.length),lens,groups:bad};
  return{kind:'shape',cells:cs,sizes:groups.map(g=>g.length),lens,groups}}

 // ---- tapestries: each 8-column block is a playable piece ----
 const PIECE=8;
 const TAPESTRY_CFG={minLen:2,prefLen:3,kmin:1,kmax:1,torn:0,cands:10,botRuns:6};
 const TAP=[
  {id:'duck',name:'Duck Pond',short:'Duck',background:'#43d5dc',palette:{B:'#16a8e0',C:'#f3f8f9',K:'#136778',O:'#cfe5eb',T:'#e0714b'},diff:1,diffs:[2,1,1,1,2,1,1,1,1],difficultyLabels:["medium",null,"hard","medium","hard",null,null,"medium",null],cfg:{},art:`
BBBBBBBB ....BBBB BBBBBBBB
BBBB.... .......B BBBBBBBB
B.BBB... ........ ..BBBBBB
B..BB... .BBB.... .....BBB
BBBB.... BBB...CC C......B
..BBBBB. B.B..CCC CC......
BBBBBCCC CB..CCCC KCT.....
.BBCCBBB B...CCCC CCTT....
BBB..... ....CCCC C.......
........ .....CCC CC......
CC.CCC.. ...CCCCC CCC.....
C..CCCCC CCCCCCCC OCC.....
C...CCCC CCCCCCCC OCC.....
C...CCCC CCCCCOOO OCC...C.
.....CCC CCCCCCCC CCO...C.
BBB.TTCC CCCOOOCC OO.....C
.BBTTT.. .TCCCCOO .......C
....T... TTTB.BBB BB.....C
.BB.CC.T TT....BB BBBC....
C....CCC TTCBCBBB BBCCBBB.
.C...... BBCCBBBB BCCBBBC.
BCCB.CCC BBBBBBBC CCBBB...
BBBB.... BBBBCCCC BBBBBB..
BBBBBBBB BBBBBB.. BBB.BBB.
`,spools:`
B16 B10 B6 B3 B2 B1 C3 C2
B4 B2 B2 B2 B2 B1 B1 B1 C12 C1 C1
B17 B9 T3 K1 C6
B3 B3 T2 C21 C5
O3 O3 C36 C7 C3
O3 O2 O1 C6 C4 C3 C2 C1 C1
B7 B6 B2 B2 B1 T3 T1 T1 C5 C3 C3 C1
B20 B8 B3 B1 B1 O2 T5 T3 C5 C4 C3 C1
B6 B6 B5 B3 B3 B3 B1 B1 B1 C7 C2 C1
`},

  {id:'moon',name:'Moonlit Clouds',short:'Moonlit',background:'#17295f',palette:{C:'#efe0a8',G:'#34609c',K:'#0c1633',T:'#5584bc',V:'#464f98'},diff:2,diffs:[2,2,2,2,2,2,3,3],difficultyLabels:[null,null,null,null,null,null,"medium","medium"],cfg:{},art:`
........ ........
........ .C......
.C...... ........
....C... ..CCC...
...C.... ....CC..
........ .....CC.
......C. .....CC.
........ .....CC.
C....... .....CC.
........ ....CC..
..C..... ..CCC...
........ ........
.....C.. .C......
..C..... ........
........ .....C..
K....... ........
K....... .......G
K....... ......GG
KK..C... .C...GGG
KKK..... ...TGGGG
KGGG.... ..TTGGGG
KKGGG... TTTGGKGG
KKKKGGVT TTTGKKKG
KKKKKTTG TTTGGKGG
KGGGTGGT TTGKKKKG
KKGKGGGG GGGGGKKK
KKKKGGGK GGGGGKGG
KKKKKGKK KGGGKKKG
KKKKKGGK GGKKKKKK
KKKKGGKK GGGGGKGG
KKKKKKKK KKGKKKKK
KKKKKKKK KKKKKKKK
`,spools:`
C1 C1 C1 C1
C7 C3 C1 C1
K1 C1 C1 C1 C1
C6 C1 C1 C1
G7 G1 G1 V1 T2 T1 K15 K4 C1
G9 G5 G4 G3 G3 T12 K3 K1 K1 C1
G5 G4 G4 G3 G1 G1 T1 T1 K22 K12 K7 K3
G11 G7 G4 G3 G2 G1 T2 K20 K10 K2 K1 K1
`},

  {id:'cottage',name:'Meadow Cottage',short:'Meadow',background:'#f7edb7',palette:{B:'#5a6d17',C:'#d6e9e2',G:'#ce7848',K:'#293e12',N:'#4f4c18',R:'#c4ad3a',T:'#9a5b38',V:'#809462',Y:'#d9d0a1'},diff:2,diffs:[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],cfg:{},art:`
........ ........ ........
...BBBBB .....CC. .....CC.
..KBBBKB ....CCCC ..CCCCC.
KBBBBBKK B....CCC ..C...BB
BBBBKBBK BB.....C ....BBBB
BKBKKKKK BB...CCC CC.BBBBB
BKKKKNNK BB...CC. ...BBKBN
KKKKKNNK KKK..... ..BBKKBN
KNNKKNKK KBKRRRR. ..BBKKKN
KBNNKNKK BBRRRRRR VVBNNKKN
KKKNKNKB BBVVVVVV VVBBNNKN
.KKNNNKB BTTTTTTT VVVVBBNK
..KNNKKK TTTTTTTT TVVVVBNK
.KKNKKBT YTTTTGTT TTVVVBNK
.KBNKBT. .YTTTGGT TTTBVVNK
KKNNKT.. YYTTTTTT TTTTRRNN
KKNKKK.. .YYTTTTT TTTTRRNN
KBNKKKNN N.YYYYYY YYYKRRNK
BBNKKKBN NBY.NN.N .NYKBRNK
BKKKKBBN BBY.NN.N .NYKBBBK
KKKKKKBB BKK....N ..YKKKKK
KKBBBBBK KKKKKBBB KKKKKKKK
BBBBBBBV BBBBBBBR RRBBBBBB
BBBBVVVV BBBBBBVV RRBBBBBB
BBBVVVVV BBBBBBBB RRRRRRRR
BBVVVVVV BBBBBRRR RRRRRRRR
BBVVVV.. ..BRRRRR VVVVVVVV
VVVV.... ..YRRVVV VVVVVBBB
VVVVNN.Y YYRRVV.. ..YVBBBB
VVVVNVNR NRRVVYY. .YYBBBBK
VVVVVRRR RRVVNNYY YYNBBBKK
GGVRRRRR VVVVNBBN BBNBKKKK
RRRRRRRV VBBBBBBB BBBBKKKK
RRRRRVVV VVVVVVVV BBBKGGGK
BGKKBBBB BBBBBBBB BBBKGRGK
GRGKKKBB GBBBBBBK BBGGKGKK
GKKGGKKG RGBBGBBK KGRGGGKK
KKGRRGKG GKKGRGKK KKGKGGKK
KKGGGKKK KKKKGKKK KGGKKKKK
KKKKKKKK KKKKKKKK KKKKKKKK
`,spools:`
B9 B6 B4 B4 N4 K7 K7 K4 K4 K1 K1
B4 B3 K3 C4 C4 C4 C3
B5 B4 B4 B4 N2 K3 C8 C2
B2 B1 B1 B1 B1 N8 N5 N4 T1 T1 T1 K7 K7 K6 K6 K4
R10 G3 B3 B3 Y3 Y1 V6 T25 T6 K1 K1
R2 B5 B4 B1 V13 V4 N6 N4 N3 T7 T3 K4 K3 K3
B18 B4 B3 V5 N4 N3 K11 K10 K3 K1
R1 B13 B4 B3 Y5 Y5 V2 N4 N3 N2 T5 K7
R5 R4 B12 B4 Y6 N4 N2 T4 K14 K5
R9 G2 B7 Y1 V23 V10 V1 N3 N1
R10 R6 B14 B2 Y4 Y2 Y1 V7 V6 N3 N1 N1
R16 B15 B2 Y5 V7 V7 N2 K4 K3
R12 R2 R1 G4 G2 G2 G2 G1 G1 G1 B6 B1 V4 K14 K7 K4
R1 R1 G1 G1 G1 G1 G1 G1 G1 B11 B7 B4 B3 V9 K17 K4
R1 R1 G8 G5 G3 G1 B12 K8 K8 K6 K5 K3 K2 K1
`},

  {id:'jelly',name:'Starlit Jellyfish',short:'Starlit',background:'#161615',palette:{B:'#4b59aa',C:'#f5fbfb',G:'#44b2e1',K:'#1d2949',N:'#142e78',R:'#9ebedd',T:'#327c7b',V:'#167fc0'},diff:3,diffs:[3,3,3,3,3,3,3,3,3,3,3,3],cfg:{},art:`
........ ...CCCCC C.......
.....C.. ..CTTTTT TCC....C
..C....C CCNNNNNN TTTC..C.
.C.C...C NNNNNNNN KKTTC..C
..C...CG BBBBBBBB KKKTTC..
......CG GGGGGVVV NNGGTC..
......CG GGGCGGVV CNNGGTC.
......CG GGGCGGGG CVNKTTC.
......CC GGGCCCCG CGBBBTC.
...C...N CCCCKVVC CGVBBTC.
..C.C..N VKKGG.VV CCVCBCC.
...C..NN VKKG..VV KCCBBC..
......NV ..GG.GB. GNCCCC..
.C..VVV. .GG..GB. G.VC....
....V... NN..G.B. G.V.....
...VV..R N..GK.B. G.V.....
..NN...R ..VV..R. V.V.....
..N..NNR RVV.K.R. V.V.....
.NN.N..R RV.V..R. V.V.....
.N..N.RR RN...RN. N.V..CC.
.N.N..RR NN..BBN. N..K..C.
...KKGNN N..KKBN. N.KK....
..RKKNNN ...KKN.. ..K.....
...KGNR. .KKK...N ..K.....
..KK.... NK..R... KKK.....
..K..N.N NK.KR.K. .V.CC...
.KK..N.N GG.K..K. .V..C...
RR...R.K ......K. .VV.....
.R....K. ..K...RR ........
........ ..VV..R. ........
........ V....... ........
........ V....... ........
`,spools:`
G4 C4 C2 C1 C1 C1 C1 C1
G11 G6 B8 V5 N14 T5 C5 C2 C2 C1
G4 V1 N5 T9 T3 K5 K1 C2 C2 C2 C2 C1 C1 C1 C1 C1 C1
R1 V6 V1 N5 C2 C1 C1 C1 C1 C1
G7 G3 G2 G1 G1 G1 B4 V6 V2 N3 K4 K1 K1 C8 C1
G4 G2 B5 B3 V3 V2 N1 T2 K1 C9 C7 C1
R7 R1 R1 G1 G1 N7 N6 N2 N2 N1 K5
R3 R3 R1 B3 V5 V1 N4 N3 N1 N1 K7 K1
V4 V3 N3 K5 C3
R3 R1 N2 N2 K5 K1 K1
R3 R2 G2 V2 V2 N2 K3 K2 K2 K1
V4 K3 C3
`},

  {id:'fox',name:'Fox in Bloom',short:'Fox',background:'#295d56',palette:{B:'#49855e',C:'#d1b4b4',G:'#e46d1c',K:'#3c281c',N:'#b23c16',O:'#94a0a6',P:'#c6868f',R:'#8ba772',T:'#b6616d',V:'#8d8920',Y:'#cbc040'},diff:3,diffs:[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],cfg:{},art:`
TTTTTTTT TTTPPPRR RRRRRRCC PPTTTTTT
TTTTTTTT TTTPPPRR RRRRRRCC PPTTPTTT
TTTTPPTT TPTPPCCR RRRRCRCC PCPTPTTT
TTTTTTTT TTCTPPCC RRRRRCCC PPPTPTTT
TPTTPTTP PCTTPPPC CRRRRCRR PPCPTTTT
TPCTPTTP PPCPPCCC RCRRRRCR RCPPPPPT
TTTPPCCC PPCPCRCR RRRRRRRR CCPPPCCT
TTTCCCRR CCCPCCRR KRRRRKRR PCCCPPPP
TKBKBBBK RCCCCRRR CKRRKCRR CRRCCTTT
KBTKBKKK BRCRRRRR CKRRKCRR RRRRBBCC
BBBKKKBB BBBBBRRR CGGGGCRR RRBBBBKB
BBKK.KBB BBBBBBBG GGNNGGRB BBBBBBKB
.KK.PKKB BBBGGGBG NKNNKGBB BBBBBBBK
KKP.CPCB BBGGGGGN CCNNCCBB BBBBBBBK
K..CKCCB .GGGGGGN OCKKCBBB BBBBBBBB
K..KK... GGGGGGGN OOOOOBBB BBB..B..
K.KK...G NGGGGNGN OOOCGBBB ........
K.KK...G NNGGNNGN OOOCG.B. ........
K.KK..GG NNGNNNNN OOCGG... ........
K.KKKGGG NNNNNNNN OOCG.... ...C....
K.KK.CCC NNN.NNNN OOGG.... ..CPC...
V.KK.CCO NK.KK.NK .NN..... ...C..C.
PCVV.COO .K.K..NK .NK....C .....CPC
PPCCVOO. .K.K..KK .NK...CP C.K.CPTP
YYPCCYYY .K.K..KK .KK....C .CKT.CPC
PPPVVPYY YYYVVVKK .KK..KKK CKKT..C.
VVKVPPYY YPYYYYYK .KK....P PP.TT...
CKKKCPPP KCCPVVYY YYK..... PPP...P.
KCPCPCPK CCPTPYYY YYYYYYY. ..P.PPTP
CCPVCVPP PPVPVVVV VVVVYYYY Y..KKCPC
VCPPVPPP PCVVVVVV VYYYYYYY YYYY.C.C
PPPVVCVC VVVVVVVV VVVVVVVV VVVYY...
`,spools:`
R2 P4 P2 P2 P2 T29 T8 T8 C6 C1
R5 R3 R1 P12 P5 P5 P1 T7 T3 T3 C6 C5 C3 C3 C1 C1
R23 R18 R7 K1 K1 C10 C1 C1 C1 C1
R1 P11 P9 P4 P3 P1 T21 T4 C3 C3 C2 C1 C1
B7 B4 B3 B3 B1 P1 P1 P1 T1 T1 K8 K4 K4 K4 K3 K1 K1 C3 C1 C1
R10 R1 R1 R1 G19 G2 G1 G1 B18 B1 N3 C4 C1
R7 R4 G9 B11 O6 N6 N1 K2 K2 K2 K1 K1 C3 C3 C3 C3
R8 B32 B6 B2 T3 K2 K2 C2 C2 C1
G4 G3 V2 V1 V1 P3 O5 K13 K5 C5 C2 C1 C1
G4 G3 G2 N18 N11 N3 N1 K4 K4 K3
G7 B3 B1 P1 O12 N4 K2 C2 C2 C1 C1
P1 P1 P1 P1 T1 K1 C1 C1 C1 C1 C1 C1 C1 C1 C1
Y7 Y2 V3 V3 V2 V1 V1 V1 V1 P8 P5 P4 P3 P2 P1 P1 K3 K1 K1 K1 C3 C2 C1 C1 C1 C1 C1 C1 C1 C1
Y14 V19 V3 V2 P3 P1 P1 P1 P1 P1 T1 K5 K1 K1 K1 C4 C1
Y17 Y3 V11 V2 P1 K7 K3 C1
Y7 V3 P6 P2 P1 P1 P1 P1 T4 T1 K3 K2 C2 C2 C1 C1 C1 C1 C1
`},

 ];
 function makePictures(first=21){
  let n=first;
  return TAP.map(({art,cfg,spools,...pic})=>{
   const rows=art.trim().split(/\r?\n/).map(row=>row.replaceAll(' ',''));
   const w=rows[0].length,h=rows.length,cols=w/PIECE,count=cols*(h/PIECE),firstNo=n;
   n+=count;
   const piece=i=>{const px=i%cols*PIECE,py=(i/cols|0)*PIECE;return rows.slice(py,py+PIECE).map(row=>row.slice(px,px+PIECE))};
   return{...pic,cfg:{...TAPESTRY_CFG,...cfg},rows,w,h,cols,count,first:firstNo,piece,baked:spools?spools.trim().split(/\r?\n/).map(l=>l.trim()):null};
  });
 }
 // ---- difficulty-targeted spool split ----
 // A heart is lost when a committed path strands cells of its colour (the rest can no longer be tiled by the remaining spools).
 // "Trap rate" = share of random legal commits that get rejected. The splitter tries many spool-length sets per colour, measures that
 // rate by simulated play, and keeps the set closest to the designer's difficulty (1 easiest .. 5 hardest).
 const TRAP_TARGET=[0,.03,.15,.35,.6,.85],DIFF_HEARTS=[3,3,3,4,5,5],DIFF_NAME=['','Easy','Gentle','Medium','Hard','Brutal'];
 function colorComps(A,cs){const set=new Set(cs),seen=new Set(),out=[];for(const c of cs){if(seen.has(c))continue;const q=[c];seen.add(c);for(let k=0;k<q.length;k++)for(const j of A[q[k]])if(set.has(j)&&!seen.has(j)){seen.add(j);q.push(j)}out.push(q)}return out}
 // k parts >= minLen summing to n; weights random so lengths range from balanced to very uneven
 function randSplit(n,k,minLen,rng){if(k*minLen>n)return null;const extra=n-k*minLen,w=Array.from({length:k},()=>-Math.log(1-rng()*.999)),tw=w.reduce((x,y)=>x+y,0),parts=w.map(x=>minLen+Math.floor(extra*x/tw));
  let left=n-parts.reduce((x,y)=>x+y,0);while(left-->0)parts[rng()*k|0]++;return parts.sort((x,y)=>y-x)}
 // simulated random play on one colour: returns [rejected commits, attempted commits]
 function trapCount(level,color,lens,rng,runs){let att=0,rej=0;
  for(let r=0;r<runs;r++){const spools=lens.map((l,i)=>({id:i,color,length:l,done:false})),st=makeState(level,new Set(),spools);let guard=0;
   while(spools.some(x=>!x.done)&&guard++<30){const open=spools.filter(x=>!x.done),sp=open[rng()*open.length|0],p=randomPath(st,sp,rng);if(!p)continue;
    att++;p.forEach(i=>st.stitched.add(i));sp.done=true;
    if(solveColor(st,color,{limit:5000}).status==='unsolvable'){rej++;p.forEach(i=>st.stitched.delete(i));sp.done=false}}}
  return[rej,att]}
 function splitLevel(rows,o={}){
  const {diff=3,seed=1,name='Level',number=0,minLen=2,maxSpools=12,cands=24,runs=8,preferLongSpools=false}=o,target=o.target??TRAP_TARGET[diff],rng=mulberry32(seed*7919+diff*31+5);
  const level=parseLevel(name,rows,number),A=adj(level.w,level.h),colors=COLORS.split('').filter(c=>level.cells.includes(c)),picks=[];
  for(const color of colors){const cs=level.cells.map((x,i)=>x===color?i:-1).filter(i=>i>=0),comps=colorComps(A,cs),seen=new Map();
   const measure=(lens,paths,random)=>{
    if(!o.routeDifficulty){
     const [rej,att]=trapCount(level,color,lens,random,runs);
     return {lens,rej,att,rate:att?rej/att:0};
    }
    // Count steps with more than one available direction along a valid cover.
    const remaining=new Set(cs);
    let choices=0,steps=0;
    for(const path of paths){
     for(let i=0;i<path.length;i++){
      remaining.delete(path[i]);
      if(i===path.length-1)continue;
      steps++;
      if(A[path[i]].filter(next=>remaining.has(next)).length>1)choices++;
     }
    }
    return {lens,rej:0,att:0,rate:0,choices:steps?choices/steps:0};
   };
   const t0=Date.now();for(let c=0;c<cands;c++){if(c>2&&seen.size&&Date.now()-t0>(o.budgetMs??1200))break;let lens=[];const mode=c%6;
    for(const comp of comps){const n=comp.length,kmax=Math.max(1,Math.min(7,n/minLen|0)),kmin=Math.min(kmax,Math.ceil(n/(o.maxSpoolLen??22)));
     const k=mode===0?1:mode===1?Math.min(2,kmax):mode===2?kmax:1+(rng()*kmax|0),sp=randSplit(n,Math.max(kmin,Math.min(k,kmax)),minLen,rng)||[n];lens=lens.concat(sp)}
    lens.sort((x,y)=>y-x);const key=lens.join();if(seen.has(key))continue;
    const spools=lens.map((l,i)=>({id:i,color,length:l,done:false}));
    const result=solveColor(makeState(level,new Set(),spools),color,{limit:8000});
    if(result.status!=='solvable'){seen.set(key,null);continue}
    seen.set(key,measure(lens,result.paths,rng))}
   let list=[...seen.values()].filter(Boolean);
   // Add balanced and long-with-short-tail candidates without displacing the
   // original search or consuming its random stream for subsequent colours.
   if(preferLongSpools){const extraRng=mulberry32(seed*131+color.charCodeAt(0));
    for(let c=0;c<6;c++){let lens=[];
     for(const comp of comps){const n=comp.length,kmax=Math.max(1,Math.min(7,n/minLen|0));
      const count=Math.min(kmax,Math.max(1+(c/2|0),Math.ceil(n/(o.maxSpoolLen??22))));
      lens=lens.concat(n<count*minLen?[n]:Array.from({length:count},(_,i)=>c%2===0?Math.floor(n/count)+(i<n%count?1:0):i===0?n-(count-1)*minLen:minLen))}
     lens.sort((a,b)=>b-a);const key=lens.join();if(seen.has(key))continue;
     const result=solveCells(level.w,level.h,cs,lens,8000);if(result.status!=='solvable')continue;
     const entry=measure(lens,result.paths,extraRng);seen.set(key,entry);list.push(entry)
    }
   }
   // fallback: spools cut from random walks always tile the colour (blobby regions often have no Hamiltonian-path split)
   for(let t=0;!list.length&&t<40;t++){const paths=partition(A,cs,rng,{minLen,prefLen:preferLongSpools?Math.max(3,minLen):minLen,kmin:1,kmax:Math.max(2,Math.ceil(cs.length/5)),torn:0});if(!paths)continue;const lens=paths.map(p=>p.length).sort((x,y)=>y-x),key=lens.join();if(seen.has(key))continue;const e=measure(lens,paths,rng);seen.set(key,e);list.push(e)}
   if(!list.length)throw Error('no valid split for colour '+color+' in '+name+' (check for isolated single cells)');
   picks.push({color,list,cur:null})}
  // Editor ranks lexicographically: fewer tiny spools, fewer total spools, then
  // trap target. A noisy trap estimate must never reward fragmenting a good path.
  const routeTarget={easy:0,medium:.25,hard:1}[o.routeDifficulty];
  const routeScore=x=>Math.abs(x.choices-routeTarget)+x.lens.length*.035;
  const compare=(a,b)=>o.routeDifficulty
   ?(o.routeDifficulty==='easy'?0:a.lens.filter(n=>n<=2).length-b.lens.filter(n=>n<=2).length)||routeScore(a)-routeScore(b)
   :preferLongSpools
   ?a.lens.filter(n=>n<=2).length-b.lens.filter(n=>n<=2).length||a.lens.length-b.lens.length||Math.abs(a.rate-target)-Math.abs(b.rate-target)
   :score(a)-score(b);
  const score=x=>Math.abs(x.rate-target)+x.lens.length*.002+Math.max(0,x.lens[0]-24)*.006;
  for(const p of picks)p.cur=p.list.slice().sort(compare)[0];
  // keep the tray within budget: shrink the colour with most spools to its closest-to-target split that has fewer spools
  let guard=0;while(picks.reduce((x,p)=>x+p.cur.lens.length,0)>maxSpools&&guard++<40){
   const p=picks.filter(q=>q.list.some(x=>x.lens.length<q.cur.lens.length)).sort((x,y)=>y.cur.lens.length-x.cur.lens.length)[0];if(!p)break;
   p.cur=p.list.filter(x=>x.lens.length<p.cur.lens.length).sort(compare)[0]}
  let id=0,rej=0,att=0,lo=0,hi=0;
  for(const p of picks){for(const l of p.cur.lens)level.spools.push({id:id++,color:p.color,length:l,done:false});rej+=p.cur.rej;att+=p.cur.att;
   lo+=Math.min(...p.list.map(x=>x.rate))*p.cur.att;hi+=Math.max(...p.list.map(x=>x.rate))*p.cur.att}
  const st=makeState(level);for(const p of picks){const r=solveColor(st,p.color,{limit:200000});if(r.status!=='solvable')throw Error('split unsolvable '+name+' '+p.color);for(const path of r.paths)level.solution.push({color:p.color,path})}
  level.diff=diff;level.trap=att?+(rej/att).toFixed(2):0;level.trapTarget=target;level.trapRange=att?[+(lo/att).toFixed(2),+(hi/att).toFixed(2)]:[0,0];return level}
 // "B15 B11 T8" -> level (used for baked splits: no search at load time)
 function levelFromBaked(number,name,rows,text){const level=parseLevel(name,rows,number);let id=0;
  for(const tok of text.trim().split(/\s+/))if(tok)level.spools.push({id:id++,color:tok[0],length:+tok.slice(1),done:false});
  const st=makeState(level);for(const c of COLORS.split('')){if(!level.spools.some(x=>x.color===c))continue;const r=solveColor(st,c,{limit:200000});if(r.status!=='solvable')throw Error('baked split not solvable: '+name+' '+c);for(const path of r.paths)level.solution.push({color:c,path})}
  return level}
 const spoolText=level=>level.spools.map(x=>x.color+x.length).join(' ');
 function generateTapestry(first=21){const out=[];
  for(const pic of makePictures(first))for(let i=0;i<pic.count;i++){const n=pic.first+i,name=pic.name+' '+(i+1)+'/'+pic.count,rows=pic.piece(i),diff=pic.diffs?.[i]??pic.diff??3,baked=pic.baked?.[i];
   const lv=baked?levelFromBaked(n,name,rows,baked):splitLevel(rows,{diff,seed:n,name,number:n});
   if(baked)lv.diff=diff;
   Object.assign(lv,{difficultyLabel:pic.difficultyLabels?.[i],hearts:DIFF_HEARTS[diff],pic:pic.id,picName:pic.name,picShort:pic.short,piece:i,pieces:pic.count,px:i%pic.cols,py:i/pic.cols|0,cols:pic.cols});out.push(lv)}
  return out}

 return{applyMiniOverride,trapCount,colorComps,adj,splitLevel,levelFromBaked,spoolText,TRAP_TARGET,DIFF_NAME,DIFF_HEARTS,COLORS,regionSize,strandInfo,makePictures,generateTapestry,DIFFICULTY,mulberry32,makeState,neighbors,cell,remaining,lengths,solveCells,solveColor,solve,isSolvable,legalNext,validStarts,analyzeSpool,countPartitions,botSim,humanSim,failTarget,pathStatus,autoRun,autoStitch,ASSIST,FIXTURE,MOTIFS,parseLevel,generateLevels,metrics};
})();
if(typeof module!=='undefined')module.exports=Logic;
