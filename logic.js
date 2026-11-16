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
  {id:'duck',name:'Duck Pond',short:'Duck',background:'#43d5dc',palette:{B:'#16a8e0',C:'#f3f8f9',K:'#136778',O:'#cfe5eb',T:'#e0714b'},diff:1,diffs:[2,1,1,1,2,1,1,1,1],difficultyLabels:["medium",null,"hard","medium","hard",null,null,"medium",null],cfg:{},hires:{k:4,palette:'B38d3dd B0297d9 Bb7d7e7 Beaf5f6 B67d9e0 Bce5c29 B2a9bcf .ed6d2e .edf7f6 .0898d7 .b7d7e7 .c1411e .66dee0 Cfafbf7 C0395d7 Ccee5ee C34d9de C70d7e1 Cacccdd C189fda K687f84 T7bbdd8 Tef742c Ofafbf7 Obcdae9',data:`
33B11AB3O48B
32BJA.9Q4J48B
32B5A.2A2.A.2A2.48B
31BJ5A.A2.3A4.48B
17B23A11.3A4.BO36B
16BJ23A2.A7.A7.J37B
15B15A.6A3.A19.36B
15B20AQA23.36B
4BOB3A10BJ9A.6A.Q31.J26B
5BJ3A11B10A2.3A37.24B
4B.4A12BJ.6A2.2A3.J7BJ27.2T22B
4B.4AJ10BOB.7A.3AJ2B7O2BJ27.22B
4B.7AJ7BOB.10A.BO11B34.BO13B
4B.9A7BJ.6A3.J16BJ31.J14B
4BJT2M6A6B.9AJ2BO14BOB33.J12B
4BOJ4M2AJ6BJ10ABO17BJ8.8Q20.10B
6B4J7B2A.10AJO11BJ11.3QD6ID3Q22.5B
15B2J13AJO11BT10.Q3I8N3IQ21.J4B
15B13A.J12B11.2M14NA22.4B
2B6J7B2J10AJ15BJ7.QAD15NDA21.4B
8MAJ18BO6B4A5B7.PI17NDQ24.
9MAJ24B4AJ4B5.QAI19NQ24.
8MEA11B12O2BJ.4A3B4.Q2I20NDQ23.
8MA12BJ6T5J3BT4A2BJ4.QI15NDPD3NIA.A21.
3EA4J11BOJP10DPJO7B6.M15ND3UD3NHWFA20.
JB2J15BOTI11NTJ5BOJ5.QD15NDUSP4N3WF20.
12B7OJP12NPVO4BJ6.QI15ND3UD3N4WHF18.
2BJ8BOJ7TI2NI7DIDTJ5B7.AI15ND3UD3N4W3HF16.
3MAJ5BJTPI5DINID10TO2BJ9.QD17N3D4NH7W16.
4MAJ4BSD9NTJ10O3B10.QI8NPY14NH7WFA14.
4MAJ2BOTYNI6DIDJO12B11.QI8NPY14NH7WHA14.
3M2J2BOJP2D8TJ13BJ11.QI5NPYP3N2Y9NSF8WHA14.
JBJ6B3T2O8BJ23.QI8ND4P7N2PW9LV15.
9B4OB32.QD8NP3Y8NYS10LA15.
13BJ33.A18NPYVA26.
8BT38.QD17NPS28.
47.Q2VI15NPCA27.
49.AS16NDYSQ25.
14.5Q31.VI17NDM25.
13.AD4IM3Q22.5QAKP17NDQ24.
.Q2.3Q5.QD6N2IDQ20.QP5DPY18NDSV22.
3.QDNPQ4.QD9N2Q15.5Q6N2P19N2SA21.
.QRINIQ6.S9NIDQ5.8QAD4I28NDS21.
QD3NM5.AQSYDI8N2AQ2.Q9I34NS21.
Q4NQ4.QD2ISCYI7N2ID3RI32N4X6NSA20.
I3NIQ4.QI2NIYCP46NX2YX7NDQ19.
2NI2Q5.QI9NI2SY39NXYPX8NQ19.
2NIQ6.QI9NSD41NXYPX7NIA19.
2NIQ6.QKI8NS42NX2PX8N2KQ17.
INI2Q6.GSY7NSI41NXYPX8NYKQ17.
2Q2NIQ6.2GKI5NY2SI22NISY14NYCYX8NYKQ17.
.QDNIQ6.JTVKYI3NI4SI4NI2S12NISDI12NPYPYPX8NYKQ10.3Q4.
.4Q7.GVD4YD3ND7S2YD12N2Y4N9XY2CYPIX6N3YKQ9.QDIDQ3.
.Q10.GV11NY3SI13N4S5N2X3Y2P2Y3CY3X6NYCYKQ9.Q3NQ3.
.Q10.2GI10NPC2SI11NID2SCP5N3PY4P3CYP3X4N2PYCYKQ9.QINIQ3.
MQ12.VI10NP3SI8NI3SCY7NYC2Y4PYCY5X4NPY2CKYQ8.QD3NQ3.
3MQ10.GS3Y8NYP11SC2DI8NY10P8NY2CYCTJ9.Q2NIPQ3.
2MR4MQ7.VSKYD7NPYC5S2Y2SCP29NDY2CYCTB9.Q2N2Q4.
J8MQ5.2GSK3YP5N2Y3C2SD34NY3CYCTB9.Q2NQ5.
OJ.M3R4MQ5.TVKY2CY6NPYC4S12NI2S17NP4CYSTJ9.Q2DQ2.3Q
3B3JTE3RE2M2.2AGSCY2CY7NY2C3SI5N2XD4SI4X8N2XP3Y2C2YKT12.2Q2.QDNI
7BJTE2R4M4HFS2YCY7NY3C11S2D6X8NXIY5CKYVJ16.Q3N
9B3JTGH6WFY3C3YD2N2IYCYC7SCYI8X7N2PY4CYC3G16.QD3N
11BJ4H6WLFCY3C6Y2CY3CDINXI9XP4Y2PYPY4C2YS2GT16.Q4N
5J5BJG10W2LSK2Y7K8Y11NIP4C2YCY6KYGJT17.QI2NI
EM2REJ3BJ14WLGSK7Y3S5C13Y8C2K2YK3G19.QI2NQ
T4MAJ3BLF9W3LUJ2GS5KSFLFC2Y20C5Y2KSGJ2.Q7MQ9.QI2NQ
OJ.3MAT2B2L10W2LG.JO6GUHWLSP24C2K4GT3M6R3M8.AINDQ
OB.4M.TO2J2L2H4WHLUG.A.T2.2JG2L3WLWHC3Y3C4K3C5YC5VJBG2AE3M5R3MA6.QDN2Q.
3B2J4M2JT3L4W3LJB4A2.2JG2L3W3LYCPC10Y5CS5GTJTEMEM2R4M2R3MQ4.QAIDQ2.
3B2OJE4MA.GLH3W2LJ2B2J4TLFL8WF2LV3C4K2CS6G3JA5ET4JE3RM2RMR2M2.QDIMQ.Q.
6B6J2BJ4LG2T2B2O3BG2H10W2L11G4OJ3.AB5J2B3O4JEM4RM2.Q2IQ2.Q.
13BOJI3N2DPTO3BJG10W3L2J12O2B6.10B5OJ2M2R2M3.2Q5.
2B2O6B2ABOTI5NVJO2BJF10W2LGJ2BO12B.A2.12BO4T2OJR4M10.
O2TJO4BJAEJOJ3I2NIG2T2BJF10WLG2B2OBJA12.13BOGD2IDTOJR2M12.
T2IPTO4BJEMA2J2TD2NDIPJ2OJU2L6W2LJB2JT2A11.15BOTI3NDJBR2MQ2.5M4.
T3NDT4OB3MTBOJPI4NG3TG2L6W2LOTDINPT26BOJD4NTJ4R3EREREMA2.
TDI2ND3TBOJ3MAJOJTD2I2D2P2DP2L4W2LJTS2NDGO2BOJ2T2J17BOJTD4NRE5RE4JTE2M.
O2TD4IPJOB4J2B2O10T2O5LJTD2NITO2BOTPIDIDTO14BOTPI4NIT7J2B3O2J2M
OBO2T2JTJ2OB4O4B10O2BOG3JBR3NIT3OJD4NDTO13BOTD6NDJO8BJTJBOJA
3B4O4J16B5J3B3AM4ND4TD2ID2T14BOTP5NIDTO7BOJPIPTO2B
5BOJPDIPJO6B3O3BOB11ATI4NIDID4T2O9BJ2A2BOJI5NAT9BOT3NTOBO
4BOJGI2NDTO6BJTJB4OJ8AJBJPI6NPJ3O9BJ.3ABOJTI4NDJO8BOJP2NITO2B
3B2OPINITJ6BOJP2ITJ2T2J5TJ5BJTDI2DIDTO11BJT2AJ2BTSD4NITO9BOTI2NDTO2B
3B2O3NIT2O5BOT3NI7D2IDJO4B2O6TO10BJ3A.J2OJP6NPJO7B2OJI2NDTO3B
3B2OP3NDT3O3BOJ2I11NDTO6B6O7B2J4AT2B2OJGI4NIDTO8BJTANIDTO4B
4BOT4ND2TJ5BJTD7ID3T16BJ7A.J2BJ3TPI5NGTO7BOJYINIGTO5B
4BOJD6NDTOB4O9T3O9B4J8A2J2B2OJPIDI4N2IPJO9BTD2NDJO6B
5BOTDID2INDTOB4J9B4J8B10AB3OJ4TD4N2ID3T10B2AE2ATO7B
7B7T3B17A8B5J9TPI2DI3NID3T3O7BJ5A2BO8B
7B7O3B2J11A4J11BOJDI6DI7NDTJ3O7BJ5AJ13B
17BOB9A2.BO13BOJP12N3DPJO5BJ10A14B
46BOTDI6D4ITJ2T7B7A2J16B
48B11TJ4O7B2J3B2JBO16B
94BJB
96B
`},art:`
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

  {id:'moon',name:'Moonlit Clouds',short:'Moonlit',background:'#17295f',palette:{C:'#efe0a8',G:'#34609c',K:'#0c1633',T:'#5584bc',V:'#464f98'},diff:2,diffs:[2,2,2,2,2,2,3,3],difficultyLabels:[null,null,null,null,null,null,"medium","medium"],cfg:{},hires:{k:4,palette:'.fdf2c5 .b9d0ea .2a4e85 .5584bc .86aedc .d9c68c Cf2e4af C192b60 Cd6c693 K0c1633 K34609c K1b2f5c K111f40 G294b80 V485c9f',data:`
64.
64.
64.
64.
36.H.H25.
37.I26.
64.
5.L58.
4.NIN57.
3.LIGI57.
4.NIN57.
64.
16.H.H22.7A16.
17.I26.2FG4A13.
16.H.H26.3F2G3A11.
13.L33.2F3G2A10.
12.NIN33.2F4GA9.
11.LIGI34.2F4GA8.
12.NIN35.F5GA7.
50.2F4G2A6.
51.F5G2A5.
51.2F5GA5.
52.F5GA5.
52.F6GA4.
24.H.H25.2FI4GA4.
25.I26.2FGI3GA4.
24.H.H26.F5GA4.
53.F5G2A3.
53.F5G2A3.
52.2F5G2A3.
52.2F5GA4.
52.F4GIGA4.
2.H49.F6GA4.
51.2F6GA4.
2.H48.FI5GA5.
50.2F6GA5.
50.F6G2A5.
49.2F5G2A6.
48.2F6GA7.
9.L37.2F6GA8.
8.NIN34.3F6GA9.
7.LIGI33.2F6G2A10.
8.NIN30.4F5G3A11.
37.3FAF5G4A13.
40.8A16.
64.
64.
21.L42.
20.NIN41.
19.LIGI41.
20.NIN13.H.H25.
64.
8.H.H53.
9.I54.
8.H.H53.
53.L10.
52.NIN9.
51.LIGI9.
53.I10.
57.2B5.
3L53.3BE4.
2J2L52.4BE3.
2JML51.4BNBE2.
2JML50.BD2B3NE2.
2JML49.E2D6NE.
2JML48.E3D7NE
2JML47.E4D8N
2JML46.E5D8N
2JML45.E5D9N
2JML44.E.5D9N
3J2L42.E.6D2K7N
4J2L40.E.6D4K6N
5J2L30.I7.E.6D5K6N
6J2L9.I18.IGI5.E.7D6K5N
7J2L28.I5.E.7D7K5N
8J2L32.E.7D9K4N
9J2L30.E.7D10K4N
10J2L28.E.8D11K3N
10JML11.2C14.E.8D13K2N
9JML11.4C11.2E.8D15KN
4JMLKD.CJ10.6C9.E.6DE2D17K
3JML3K2D3C7.9C6.E.6DE2D18K
3JML5K2D3C4.11C4.E.4DE2DED19K
4J2L6KD4C.13C2.EC4DE2DED20K
5J2L6K2D17CEC5DE2DE10K2L9K
6J2L7K2D14CEC5DE2DE10K2J2L8K
7J2L8K2D11CE3DE2DEK2D10K4J2L7K
8J2L10K9CE3DE2DEKD11K6J2L6K
9J6L6K4C2OCE3DE3DE12K8J2L5K
14J2L6K2C3OE2DKE3DE12K10J2L4K
15J2L6KC4ODKDE2DE13K10JML4K
16J2L6K2O3DKE3D15K8JML5K
17J2L5KE3DKE2D18K6JML6K
18J2L3KE3DKE2D20K4JML7K
18JML2KE4DKD22K4JML7K
17JML2KE4DKD22K6J2L6K
4JML12KJKE5D19K4L8J2L5K
3JML14KE5D19K14J2L4K
3JML13KE4D21K15J2L3K
4J2L14K2D23K15J2L2K
5J2L6K2L35K11J3L
6J2L4K2J2L35K11JML
7J2L2K3JML36K10JML
8J2L4JML36K10JML
14JML13K2L21K4JML6K
14JML12K2J2L20K3JML7K
15J2L10K4J2L18K4JML7K
16J2L8K6J2L16K6J2L6K
17J2L6K8J2L14K8J2L5K
18J2L4K10J2L12K10J2L4K
18JML4K10JML11K12J2L3K
18JML5K8JML11K14J2L2K
18JML6K6JML7K4L16J3L
18JML7K4JML7K22JML
18JML7K3JML8K22JML
17JML7K4JML9K21JML
16JML7K5JML18K6JML6K
15JML7K6JML19K4JML7K
15JML6K8J2L18K4JML7K
16J2L4K10J2L16K6J2L6K
17J4L12J6L6K4L8J7L
38J2L4K18JML
39J2L2K19JML
40J2L20JML
62JML
62JML
62JML
62JML
`},art:`
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

  {id:'cottage',name:'Meadow Cottage',short:'Meadow',background:'#f7edb7',palette:{B:'#5a6d17',C:'#d6e9e2',G:'#ce7848',K:'#293e12',N:'#4f4c18',R:'#c4ad3a',T:'#9a5b38',V:'#809462',Y:'#d9d0a1'},diff:2,diffs:[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],cfg:{},hires:{k:4,palette:'.5a632e .ced3b4 B71872b B293e14 B969e65 B51671a Cfaf0c0 Cc6dfdc K273d14 Ke0813f K718937 K526019 N333c14 Needc98 N645c1f R7f9461 R4c5919 Rddb43c V7d9464 Vdcbc3d V425418 T7f4621 Tb1713e Yf1e5b4 Y676030 Ge27e3b G2c3e15',data:`
96.
20.5G71.
12.8XCF2AFC3X67.
11.XA2UQ4A6LAFCG23.G4H31.G6.
10.XA4D11FQFXGX20.G7H24.G6H5.
10.XUDUDU10C5FCG18.G8HG23.7HG4.
9.2XU2D2U10C4FQFX16.2G11H19.G11HG2.
7.GXU2a2U12C6FCX13.G14HG11.G3.3G13H2.
6.XAa2I13CaID6FX13.17HG7.G21H2.
7.aIDU13CD2IL4FAN2X11.18HG6.22H2.
3.3XBU16CD3ID4FAFAX10.19H4.2G21HG2.
2.XU2aMF16CaD3I5FLQAX10.17HG3.G21H2G3.
2.UI4DU17CD3ID5FQAX12.13HG4.G8HG3.7G7.
2Xa5ID17Ca4IL5FQAX11.11H2G5.G7HG11.4X3.
9I2D2C4F10CD4ID4FLF12.11H7.G6HG11.GC2FCB2.
10IDC6F2C2F5CD5I4FLAX12.8H2G8.G4HG12.NFQFQA2X
5I3Da15F3CD5I6FCX12.2G.4G11.2G.G11.XC8F
3I2D6C10FCDIFCD5ID7FAX18.3G19.4XCQ8F
2ID11C6F2D3ID4IDL9FX17.G4HG16.XC5F6C2F
2ID11C5FL8IDL10FAX16.G6HG14.XC5F7C2F
ID14CFLD8IDL12FX12.G2HG8H6G8.X5F10C
16C2a4IDLF3L9FU2DAX11.X17HX6.EBE3F4C2FaDF3C
16CD4IDL14F3DX11.G19HG4.XA3F5CD3I2D3C
2F3CFU8Ca4IDL13FD2IDUG10.G20HG3.XC8FD3I2U4C
2F2CU2IU4Ca2D5IL14F2I2DX11.19H2G3.XC7FD4ID6C
3FUD3Ia2Ca8I9F2L2FD3I2DXG10.10H7G.G5.X6FD5ID7C
4FLU3I2a9I8FLD2ID3ID3FCXG9.G7HG14.X6F4ID2U7C
5FL3ILFL8I7FLD5ID7FCX9.7G15.XC4FD3ID10C
2FLUDM3IL2F8IM5FLD6IU6FLFX29.XKC3FUQD3ID10C
FLD7IaQD8IDID2LD6IL9FBX27.XC5FDa4ID10C
ID16I2L4ID8I9FL2UX25.XC5F3Ca4Ia6C3F
6ID11I2Oa5ID6ILF2L3FLa2IaX25.E5F5Ca4I2DCU3DFL
5I3O10IL3OD2IUL9ID2FD4IaR12TXG11.E3F8Ca5ID4I2D
4Ia3Oa9IaL2ODIDUOa9I2D5Ia15R11.E2F10CD11I
3ILFL4O9Ia2O2IL3OL15IU15RX10.BCF8CaD12I
3I3FL3Oa9I2O2aOVOLa14IU16R2TX3.4X.GXF8C10ID3I
2IDL3FL3OM2OD5I5OLa7I3D4IaURT19RXE7S2F2CFaFCa9ILOM2I
IDL5FL5OD5I4Oa8ID3FU2IF22RP7SCU3FU3IDI2MD6I2OM2I
ID7F5OD5I4O8ID5FDURT20RP8SaD3F5ID2OLa4Ia2OM2I
IDL6FUM3OD4Ia4OD6ID8FP17R4P8Sa2I3D6I3OL4IL2OM2I
2IDLFLD3IDL2OD4IL2Oa8I10FC16P12S9I3DIa2OD2Ia3Oa2I
11Ia2O4Ia3O8ID12F27SaD7IQ2O2a2OaIMLOUD3I
12I2OaIaL4OD5ID12FUa28SCD6IDU6O2aOLD4I
12I6OVOM6IL11FD3IDa27S2D7I2DM6Oa5I
3a9I8O6ID11FL5IU28SaD9I6O6I
XGBU8I6OM7IL4F2D11ID30SaD2a6Ia4OD5I
3.S8I6O7ID5F2I11aM19P2S2P11Sa6I4OD3IDI
3.GNU6I5Oa5IDL5F3D28W5V2WP10S2D5Ia3OD2IL2O
5.BQ5I5O4IDL5FLDIaM27W6V2W11SaD6I3OaIa3O
6.Xa4I4Oa2IDL4FLD3ID2W36V12Sa4ID4OULO2U
3.G3Xa4I4O2IMU4FLD3IDM2W36V2SP10Sa2DID6OLUI
3.SU2a5I4OaD3FLD4IDM4WVQ34V3WP11SP2D5OLa2I
2.BU8I4OL3FUD4IDV3WVO2EO2V9W4V2W2VW4V6W4V3W11SDID5Oa3I
.GU5ID3I4O3FL6IM4WVO2BQM15V5W16VU10SI2D4Oa4I
2.a4IDCFLa4O2FD5IDaWZW3VO2BO16VW5Z15VU10S3D4O5I
.GU4IU3CU4O2L6IaU3WUOVY2NY16VW5Z15VU3S2F6S2D4OD4I
2.XA2ID5C4Oa5I2D3W2V2O2B3.X2Q13VW7ZW3V4W7V5F6Sa4OD4I
2.XS2IU5C4O6IDM3WV2OY2X3.XYO2V4W3V2WVW8Z12WVWVL5F5SU4OD4I
.XU2IU5C5OD4IaV3WVOV2B6.2X3V4W3V5W8Z4WV5W2VW2VL4F5S4O5I
2ED2IU3C2F5OD4IO3WVOPWXB4E4.2W13V8W15VO4F5S4OM4I
2a4IF2CF6OD3IM3W2VO2B.X3OYX2.GBNO36VL2FC5R4ORQa2I
7IUFL5OM3Ia2W3VWBGX.X2Q2OX4.XQ3V5WV7WV9WV6WV2WV8R4O3RUI
8IL5Oa4Ia2W2VOWN3.X4OX4.XY3V13WV19WV8R4O3R2C
8IDU4O6IO2VQBN4.X2Q2OX4.GNBQV15WV8WV9WVW6R4O2R3C
9IM4OD6I3LBX4.XY2OYX5.XNYO15WV8WV5W6V6R4O2R3C
9IM4OD8IMX6.4X6.3NB36V6R4O5C
9IM4OD8IaX16.2NXNO35VRTR3F4O5C
9IM4OD8IaX2.6XBX6.3NB2OQO24Q2VQ3MWV3RFQL4O5C
5I4DM4OD8IaX.XCF4A2FKX4.4N30BEaIa3R5F4O3CaD
4ID4CU4OD9IXNCQL5F2LC4.4N30.X3IQRO5F4OFCa2I
3I2U4CF3OLD8Ia2N9FLFXG2.4N4.5X14.5X2.XU2IaR4FQU4O2L3I
2Ia9CUa9ID4FLU2MUL4FAX.4N3.XY3QYX3.6X3.XY3QYX.X4IMLFQDIDQ3Oa4I
IU4C3F5CD9IQ2FU6MU3FQA2X2NB3.XO3MOX2.XYQ4OX2.XO3MQX.X6ID4IQ3O5I
DU4C4F4CU7IDa3F8M4FQYB2NB3.XO3MOX2.XQ4MOX2.XO3MQX.X7I3DaQ3OD4I
3C10FCFL5Ia3C2F7M2U5FB2NB3.XO3MOX2.XQ3M2OX2.XO3MQX.X5I2D4C4OD4I
8FDID5F4ILF5CU5MU2C5FB2NB3.XO3MOX2.XQ3M2OX2.XO3MQX.X4ID8C2O5I
4F2LFL3IL3FLDIDU2F5CU4MU4C4FB2NB3.XO3MOX2.XQ3M2OX2.XO3MOX.X4IU8C2Oa4I
4FD7IDL3F2L6F2CU2MU6C4FY2NB3.X5OX2.XQ3M2OX2.X5OX.X3IF11CFa3I
3FU9IDL11FCU2MO5C6FBXB3.X5OG2.XQ3M2OX2.X4OYX.XUID14CD2I
3FD10ID3U11FU3C9FYEN4.5X3.XQ3M2OX3.5X2.XUID14CD2I
2FD15ILFL2DL5F4C3FLDIDLF2UB12.XQ3M2OX10.X2ID3Ca2Da3C4Fa2I
ID21ID11FD5ID2IUXG10.XQU4OX9.XU3IDaD4Ia6FLDI
24IU10F10ISEXG2.X3EX.XVR2T2OX.GXE2SBXBK13I4U2FDI
25IU5F4U11IaPE2XE3FA2ER3TRO2X2Ea2IaSPa17I2U2I
9IDQ3U2D10I2D20IDU9FR4TCFa6ID22I
8ID7FDI7D26IL5FQFR5TF30I
7IL18FD25I5DIMR6TQ3a26I
6ID20FD5I8a10IDQ7FR6T3RLF13LFLD6IDI
4ID24F2L2FP6SP19F4RT2RT4R24F
4U27F10S2PSP15F5R2T6R23F
29F18SP12FA9RC2PSP17F4T
28F18SP13F2P9RP3S13F8T
15FP23SPSP16F4SPT8RP2SP10F10T
14FP24SA16F8S8RP3S7F13T
12FP27SP15F7SP7RP4S5F10T3RTR
10FP32SP22F5RP4S2P7T9RTR
9FP35SP21F3RCPS3P5RT12RTR
7FP39SP20F2RFPER2T2R2T14RTR
5FP43SP17FQ2FOT4RT17RTR
4FP45SP18FRT3RT19RTR
2FP48SP15F2T2R2T21RTR
P52SP11F2T2RT24RTR
54SP8F2T3RT15R12P
55SP5F2T3RT15R2P12S
24SEXGXEXGX24S2PCRT3R15TS2P14S
24SX3.G2.G2EXGX17S2PR2T3RTR13TSP17S
23SEG7.2G2.GEXGX11S2PRT4RT3R10TS2P19S
21SX2G13.G2.GE8S2PRT4RT5R8TSP22S
21SG19.GXE4S2PR18T3P24S
16SQ3MA12.5X5.XPS2PRT2R16TP27S
16S4MUB3.5X3.5X5.GEPRT4R14TSP28S
16S5MYG2.13X2G4.RT4RTR12TSP30S
16S5MNG5.10X3N3.4R9TX.XTX.X32S
16SP4MOYG7.9G2.GXR2TR8TX6.G2EXGX27S
20SP2OX2GX4.5NBN3.XYT4R8T8.2G2.GEXGX23S
20SP3O2PYN6X2N4XNQMRT3R5TX.G13.G2.GE22S
16S7FL2MK5PSP2O5R2MR8TR20.GXE20S
11S13F2M3F3PET2MTR2TR2QR4TO3UOX11.5X5.X20S
6S17FL2ML3FC3T2OT7R4TU3MUX3.5X3.5X5.G20S
7F4L18FRTR4T8R4TU4MYG2.13X2G3.G20S
22F7T6RT4R8TO4MNG5.10X3N2.G18S2I
22T10RT7R7TES4MOYG7.9G2.GX16Sa3I
20T11RT8R5TA6SP2ON2GX4.7N3.XYP14S2a2IDI
20T9RT10R4T5FP3S2OY2PYN6X2N4XNOMP11SPIaDQFLFL
12T16RT3R10T10F4P2MP5SES2OSESEP2MP9SP2F3L5F
3Z9T10R5T5R9T15F2MP7S2MP4S2M5SP15F
3Z9T5R5T10R7T17F2MFP6S2U5S3P20F
5Z12T15R6T24FP3S2P2SP25F
5Z6T17R8T45F13LFL
5Z23R6T46Fa2Da4M3I3DaD
28R4T38F10D3IaJ2ZJMaM5I
R4T23R2T38F2D11IMaUZ3J2ZJM4I
20R8T3FL3FLa9DaL17F3D9I2DIM10ZMIDaD
3M4U4aU8R6TUa2I6D11I2DaL10FLa2D9I2DaLFQM10ZMILFL
2ID4ZM2aIaRT6RTUa3M24I2Da6Sa2D8I4D2FL2FLM4Z2R4ZMI3F
MaU7Z2a4RCF2CFD7I3a11DaD8I6a10IDQ8FLM4Z2R2ZUMIDL2F
8ZJZMIL3C8FD3ID16FD24I5D2FLFLD2MU6ZWMIL2F
8ZJZMI11FD5I2D15FD28I5DIa9ZMI3F
4Z2R3ZJMIFL7F2D9ID14FD33IM4Z2M3ZMILFL
4Z2R2ZUMID7F2D9I4MD2I9Da28I4M2IM4ZDIWZWMIDaD
M2U6ZWMID5aD9IDa4ZMaM37Ia4ZM2I4M2I3M5I
a9ZM16IMaU7ZM34IMaU5ZUa12IDI
M4Z2M3ZM15IM10ZM33IM9ZJM11IDI
M4ZDIWZWM5I4M6IM10ZM33IM8ZJZM11IDI
I4M2I3M5Ia4ZUaM3IM4Z2R4ZM33IM4Z2R4ZM11IDI
13IMaU6ZJM2IMJ3Z2R2ZQMD11I4M18IM4Z2R2ZUMD11IDI
ID10IM7Z2JZM3I2MU6ZWM9IDa4ZUaM16I2MQ6ZWM11IDI
ID10IM7Z2JZM3Ia9ZM8IMaU7ZM15Ia9ZM5I4M4I
ID10IM4Z2R4ZM3IM4Z2M2ZJM7IM10ZM15IM4Z2MJ2ZM4IaJ2ZJUaMI
ID10IM4Z2R2ZUMD3IM4ZDIWZWM7IM10ZM15IM3ZJDIWZWM2IMaUZ3J2ZJM
ID11I2MQ6ZWM4I4M2I3M8IM4Z2R4ZM16I4M2I3M2IM4Z5JZM
ID11Ia9ZM21IM4Z2R2ZUMD27IM3Z6JZM
ID11IM4Z2MJZJM22I2MU3ZJZJWM27IMZ3J2R2JZJM
ID11IM4ZDIWJWM22IaJ7ZJM27IMJ3Z2RJZUMI
ID12I4M2I3M23IM4Z2MJZJM28I2MUZ3JZJWM
ID44IMJ3ZDIWJWM28IaJ2ZJ4ZJM
ID45I4M2I3M29IMZ2JZ2MJZJM
ID83IMJ2ZJDIWJWM
I85D4M2D3MI
96I
`},art:`
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

  {id:'jelly',name:'Starlit Jellyfish',short:'Starlit',background:'#161615',palette:{B:'#4b59aa',C:'#f5fbfb',G:'#44b2e1',K:'#1d2949',N:'#142e78',R:'#9ebedd',T:'#327c7b',V:'#167fc0'},diff:3,diffs:[3,3,3,3,3,3,3,3,3,3,3,3],cfg:{},hires:{k:4,palette:'.eceeef .9bb6d5 .4378a5 .1d2749 .183372 .43afdf Ce4ecf0 C378aad C171a23 T285977 Taac9d4 N1c3a83 N98bcdb N15161a K181a28 K1d3f6f K539ecf G49a8d7 G182847 Ge5eef5 B305a99 V1e82bf V151b25 Va5c8e0 R8eb3d4 R181f35',data:`
46.IA15GN28.C2AI
23.IOI14.I3O3IA15G6I21.IOC2AD
22.NCAKI12.I6AY16HG5AI19.IYACIDA
22.NCAKI10.IND4A2GYH14JHA4GAD2I17.IYACNZA
23.IOI10.IYAB4H3C15U4CY4GKI17.IZHGKI
36.NKAGH5J17U4JK3GAI19.HGAI
33.3IZYAB4H3C4U3C9U4JY3GK4I16.I2BI
32.I4A3C2A2G2AYL2EL2ACL7EL2U3J4HG2AGI16.2I.
30.3IA2GA3H6AYL2ELGAC9E2U7JT3A3I17.
29.NBAK4HG4AU4L4E3L9EL4ED3J2HJHKAGI16.
28.NIB2GH2JH3GAGL6E2L3E2L11E2DP6J2GAIN15.
27.I2Y4HJ2P5CL5EL7UL9E3DS3PS2J3H2YI14.
27.ITGH4J14E7UL8E9D5JTAI14.
10.2I15.IYM2H2JU2L5E5LEL7ULE2LE2DE8D2UP4JYMHI13.
9.I2AI15.J3HJEL25U12D2FED4JH2AI12.
7.2ID2A2I12.IZJ2HJU2L25UE11D2RED4JHGAHOI10.
6.IKAY2I2AI10.IGA2FU2E2U2FGAG6FH2U2VTAY2V7U2E14D3JHMABI9.
6.IKAY2I2AI8.3IAGFRU2L2U2FGAG6FQ2U2VTAY2V7ULE14D4JMGXI9.
7.3I2GDI8.NC2G2F2LH4F2TY6F5V2TH8V5U7E2DHRP4D2JMGKI9.
9.I2AI9.NC2G2FLEH4F2AY6F5V2A9V5UL6E2DQFJ4D2JYGXI9.
9.I2CI9.NC2G2FHUR2F4XR6F4RQ2T10V3U3CL4ESEUC3U2D2JC2Y2HI7.
10.2N10.NC2G6FR2TR13F2T14V2AU7ELH2F2D3J2H2AO7.
22.NC2G6FY2T13FY2T14V2AU8EHFR2D4JHGAO7.
22.NC2G6FR2T11FM2TR8F7V2AU8E3L4DPJHGAO7.
22.NCAG6FR2T11FMGT9F6VH2TUL10E2DSDPJC2AI7.
23.3IAG4FR2T11FMGT13FR2TH3VU5EL3CDS2DPJC2AI7.
14.3I8.IGAR3FY2TR10FMGT13FYAG4VULE4L3CDS2DPJC2AZN6.
13.I2BCN8.2IK3TXUC2TR6F4GT13FYAG2F3V4U2H3C2E2DP2JCY2BI5.
13.I2AC10.IA4TLEATY6F4GT13FRTG2F7V2F3CLE2DP3JCGAI5.
12.IDKACZI8.IK4TESKTMY4RY4GKY4RYR4F2RYTG2F7V2F3CLE2DP3JHGAI5.
11.I2AONC2AI8.IZX2TONEL7TU4L7T4F3TR5F5V2F3CLE5DJHGAI5.
11.I2AZIC2AI9.NBAKI.ELK5AGL4EGA5TR2FR3T6F5V2F3CLE4DSJHGAI5.
12.ID2ACZI10.NELP.N2V7L5D2J4VHT3G3T9F2V2C3U2E4DSJHGAI5.
13.I2AC12.NSES.N2V7E5D2P5VT3G3T9F2V2C3ULE4DSJHGAI5.
14.2OI12.NDES.N2VE6S2DP2U2P5V7QT3GR4F2GQ4V2U2HUDSJHGAI5.
30.DES.N2VE8DP2V2P11VQT3GY4F2AQ4V2U2FUDSJCGAI5.
28.2N3D.I2VE6D2EL2UPJ5V2U4VQ4GMR3F2GQ4V2UQFUPJCYGKI5.
27.N2EN3.N2VL2E4D2VU2PR3F3V2P7V2LGTM6F5V2UHFQ2A2I6.
27.N2EN2.NW2V2E5D2VH2P4FQ2V2P7V2EKAM6F5V2UHFY2AI7.
27.N2EN.I2VI4N2P2V2FH2P7F2P7V3DSY2T7V6UC2AI7.
27.N2EN.W2VN3.N2P2V2FU2P6FRJP7V2DSDY2A7V6UHAGI7.
25.NED2N2.N2VW3.N2P4FU2P4FC2J9V2D2HU2DXG9UYTKZI8.
7.2N16.N2EN3.W2VW3.N2P4FU2P4FC2P9V2DHFUZD2AC8UXGBN9.
6.ICHI15.N2EN.S4PN3.N2P4FU2P4FC2P9V2EHFU2DC10YCHI10.
6.I2AYI14.N2E2.UVUI5.N2P4FU2P4FC2P9V2EQFU4D2G7AD12.
6.IKAYI13.2N2EIWUVUN5.NPJ3FRUPJ4FC2P9V2EQFU2DSDK8AC12.
7.IOI13.D2ENW2VDIN4.SPO2Y2FJPUR5FC2P9V2NHFH4E2LC2VZI2OI12.
21.NID2E.N2VS6.SPJYM2F2PU6FC2J9V2OHRU6EU2VN13.IO.
20.NUVP2N.N2VS6.2DZY2MY2PU2F2Y2JC2Y2V2C2VU2W2RSI3N.IUVD2I13.Z2AO
20.I2VP3.I2VS5.N2DZYM2YJPC2FMY2PCMY2V2C2VU.N2FW5.IUVS14.NC2AO
18.N4PI.N4PN4.3DEU2Y4CQ2FMYJPCMY6CU.I2FI3.N4PN15.O2CI
18.N2VW3.I2VW6.2P2EUMY2LYMR2FMYJPCMY7CNI2FW3.I2VI18.2N.
16.2NW2VN3.W2VI5.I2PELU2YLEYM3F2YJPC2Y7CNI2FW3.I2VW21.
16.PVUWN4.N2VI3.NDPELYMY2LEL3F2Y2F2PC2F4CONI.N2FW3.I2VW21.
15.NPVUN5.W2VI3.N2JELYXYLE2L3F2Y2FJPH2F4CN2.NZ2RI3.I2VW21.
14.DEDWN4.SED2W4.I2B2LYXY2LR6F2JR4FXBCUI.I2RZN4.I2VW21.
13.N2ED5.ND2E6.OMX2LYXYLE7F2P5FXBCUI.I2FI5.I2VW21.
11.N2D3N4.3D2N4.I2CXM2LYXYLE2V5F2P2FCJU4CI.I2FW5.I2VW21.
11.N2EN5.N2EI5.NC3XM2LYXY2E2V5F2P2FUDEU3CI.I2FW5.I2VW21.
10.2N2DN5.N2ED5.NC2X2Y2L2YQ2L2V4FR2P2HU2D4CI.I2FW5.I2VW21.
9.N2EN8.2ED5.NCXY2L2C2LU2F7V2P5D2B2CI.I2FW5.I2VW21.
9.N2EN6.NI2ED5.NCXYLE2C2EU2F7V2P5DBXCUI.I2FW5.I2VW6.2I13.
9.N2EN5.N2EI2N6.CXYLE2D2EU2F4VRMBDS5D2BZN2.I2FI5.I2VN5.I2AI12.
9.N2EN5.N2EN6.IOCXYLE2DELU2F4VQXBDS5D2BI.N.W2RZN4.I2VWN4.I2AI12.
7.3D2N4.N2DIN6.I2Y3U2E2DHQH6VQXB7D2BI.4DP2HI4.SD2UI4.2O13.
6.NDED6.D2E8.IBXU4E2DH2F6VQXB7D2BI.2ED.I2FW5.IUVD19.
6.NDEDN5.D2EN7.IBXU4EPJHFR4V3Q2Y7D2BI.2ED.I2FW5.NUVD19.
6.NDEDN5.D2EN7.IBXU2E2DRF7VMXCLE5DZD2XI.2ED.N2VW5.NUVD19.
6.NDEDN3.2NDEDN7.IBXU2E2DRF7V2XC2E6DP2BI.2ED.N2VW5.NUVD19.
7.DLDN2.N2ED2N8.IBXU2E2D2LU6V2XC2E4DC2BZI.N2ED.N2VW5.NUVD19.
6.NDEDN2.N2ED10.IYBULE2D2EU6V2BCLE4DCXBI2.N2ED.N2VW5.NUVD11.2I6.
4.N2D3N3.N2ED11.IZCBYDS2EU2V2L2B2LUVU4DCXBI2.N2ED.N2VW5.NUVD10.I2KI5.
4.N2EN5.N2ED13.CXYDS2EUVUEL2BLEU2V2DZDCXBI3.2ED.N2VW5.NUVD10.I2AZ5.
4.N2EN5.N2ED11.IZQMQ2D2E3UEL2BLEU2V2DOZ3CI.2N3D.N2UI5.NUVD9.IDYBCON3.
4.N2EN5.N2ED10.NYBYFQ2D6EL2XLEU2VSD2BO.N.N2EN3.N2EN5.NUVD8.I2AOIBACN2.
4.N2EN4.NI2ES9.NZBXQFH2D6EL2BLEUVU2D2BI3.N2EN3.N2EN5.NUVD2N6.I2AOIYACN2.
4.N2EN3.N2EI10.NYB2FULE2D3ELU2B2L3E2D2CZI4.N2EN3.N2EN6.NWD2EN6.2I2A3I3.
4.N2EN3.N2EN8.2IZBX2FU2E2D4EUXBL3E3D2CN5.N2EN3.N2EN8.D2EN7.I2AI5.
5.2NDED.N2EN7.NCBY2F2LE2D4E2NP2BL3E3D2CN5.N2EN.N2EIN8.ND2EN8.2I6.
7.DED.N2EN7.NC2X2FLE3D4EN.O2BL3E3D2CI5.N2EN.N2EN9.ND2EN16.
5.IO2ED2.2DN7.NCR2YQLE3D2ELEN.I2BL2E4D2U2PD2.S3DN.N2EN9.ND2EN16.
4.N2YLED2.2D9.U2FXBLE3D2ELEN.IBXLE7D2CP.N2EN3.N2EN9.ND2EN16.
2.2NZ2MJ2E2.2DN6.IOCFY2B2E2D3ELEN.I2BLE5DSD2CP.N2EN3.N2EN9.ND2EN16.
2.DYM2AMYCN2.N2DN3.NR2FXB2L2D5ELEN.N2D2BLE5D2CP2.2EN3.N2EN10.S2DN16.
2.DYM2ABYCN3.2DN2.NZRFRXMLE2D7EN2.ZD2B2LE4D2CP2N2EN.3N2EN10.N2DN16.
2.2NZBMZ2I4.2D2.I2RZICXMDS5ELEIN3.4DRFU4D2CU2E2N.N2ED2N9.NZN19.
4.N2YN6.2DN.O2FN.CXMDS5ELEN4.2DZD2FU4D2CULEN2.N2ED11.2DN19.
5.2I7.2DP2U2P.NCXMDS5ELEN4.4D2FU4D2CU2EN2.N2EDN10.2DN19.
14.ZDUFRW2.NCXMDS7EN4.4D2FU4D2CULEN2.N2EDN10.2DN19.
14.NDUFQI2.NCXMED7EN3.N4D2FU4D2CULEN2.N2EDN10.2DN19.
12.2D.NPFQI2.NCXML5ED2N3.6D2FU2DZD2CULEN3.2EDN10.2DN19.
12.2D2.PRHI2.NCXBL5ED5.6D2FU4D2CU2EN.NI2ED2.2I6.N2DN19.
12.2DN.N2I4.I2C6EDN4.4DZD2FUSD2YO.3N.N2EI2N.I2AI4.2DN21.
12.2DN7.NI2C2L4EDN4.6DRFU2D2YO5.N2EN3.I2AI4.2D22.
12.N8.O2ULU2YL3EDN4.4D2HPSO2C2G2CI3.N2DN4.2O5.2DN21.
10.2D8.N2CUEL2XL3EDN3.N4D2FI.IYX2AMYI4.2DN11.2DN21.
10.2DN6.2D2CUEL2BL3EDN2.NS2DEJ2HI.IYMAGYBI18.N8.2I13.
10.2DN5.I2CL3EL2BL3ED2.2ZDSP2FZN4DPMYZN3.2D12.2D8.I2AZ12.
10.2DN5.I2C4EL2BL3EDWI4DJFRI.3DZD2YI4.2DN11.2DN6.ID2ACOI10.
7.NZN8.NEL4EL2XL3ELR5FHZI2DN.N.N2I5.2DN11.2DN5.I2AZICABI9.
7.2DN8.N6EL2B5LR5FHN.2D12.2DN10.N2DN5.I2A2IHABI9.
7.2DN8.NEL5EPJBMQFHZI4WI2.2DN11.2DN10.P2VI6.2IGAHZI10.
7.2DN8.NEL5E2PMXMFHN8.2DN11.2D10.NP2VI7.IAGH12.
2.N2PN.N10.N2D5EPJMXHUJN8.N14.N9.DSUQH2DN5.IYBI12.
2.D2YDZ13.N5EPJ2XZ2N7.2D16.2DN5.NUVRMY2VI6.2I13.
NIP2MPDN12.NE2L2EPJ2BP9.2DN15.2DN5.NUVQ2Y2VI21.
CYX2AMYO12.N2YU4POIN9.2D16.2SN6.NWJ2VZN22.
CYX2AMYO11.NZBMH2J2P12.2DN14.N2DN8.P2VN23.
NIPMYZN11.I2Y2AG2YJPN12.N2DN12.I2YI8.N2W24.
2.S2YI12.IYX2AGMYJPN13.2DN12.I2YI23.N11.
2.I2CI12.ICY2GY2CDSN12.N2PN11.NO2GZNI20.OCZ10.
3.2N15.ZYMCPDN14.N2VN10.IYM2AB2YI18.NCABI9.
20.I2YCPS13.2NO2VW2N8.IYM2A3YI18.NCABI9.
21.3IN14.D2V2Y2VP9.NZ2MZ2I20.IOI10.
10.2I18.NIN6.D2V2Y2VP10.N2YN35.
9.I2AI16.NUVUN5.2NO2VZ2N11.2I36.
9.I2AI15.NWCVCWN6.N2VN51.
10.2O15.NUCQFQCUI6.2W52.
27.I2VFMF2VI60.
27.I2VQYQVUN60.
28.NWCVCWN61.
30.UVUN62.
30.NIN63.
96.
96.
96.
96.
96.
`},art:`
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

  {id:'fox',name:'Fox in Bloom',short:'Fox',background:'#295d56',palette:{B:'#49855e',C:'#d1b4b4',G:'#e46d1c',K:'#3c281c',N:'#b23c16',O:'#94a0a6',P:'#c6868f',R:'#8ba772',T:'#b6616d',V:'#8d8920',Y:'#cbc040'},diff:3,diffs:[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],cfg:{},hires:{k:4,palette:'Tb6606e Tc88a93 T40553f Pc88c95 P959327 P354940 R8ca672 Rdea878 Cccadb1 C365346 K3a281c K427353 Kb2857f B48815b Bb39891 Ge57922 G2e6156 .c1858e .a4a130 Nb83e18 Nec8927 O919ea1 V8f8d22 Vc28088 Ybcc33c',data:`
40AR2BR4AR5BRB4I28G4IB2RB4I4AR2BR20A
40A4B4AB5DBD4I28G4ID2BD4I4A4B20A
40AX2BX4AR5BRB4I28G4ID2RD4I4AX2BX20A
41ARXAX2AX6BRB3I29G5I2BID3I3AXAXR21A
43AXAXR8BR32G7IDID2B2RXAX8A2R13A
25A2R17AX10BR25G2I5G8ID3R3BX8AX2BX12A
25A2R17AR8BRBR25G2I5G8IB2R4BR8AR2BR12A
23AX20AR7BR2BD33G8IDBR4BX7AR2BR12A
17AX4RXAX12A2R5AR6BRB6I36G4IDR4BRX5AR2BR12A
16AR6BX12AX2BX4AR5BRB8I36G4IBR5BX4AR2BR12A
16AR3B2RBR12AR2BR4AX5BRB8I36G4IBR5BR4AR2BR12A
17AX2R4B11AX3BR5AXR4BRB8I34G4IDR6BR4A4BX11A
20A4I9AXR4BR7AX4BRBD8I30G4IDBRB2R4BR4A3IDBRX9A
9A2R9A4I8AX6BR8AR4B2RB8I28G4ID2RBR2AR3BR4A4I3BR8A
9AXR9A4I8AR6BX8ARB5RB8I28G4IB2RBR2AR3BR4A4I3BR8A
7AX4AX8A2I8AX4B2RXAX7A6BD8I30G4IDBRB2R5BX4A3IBRX9A
5ARXA4XAX4RX10AXRBD3I3AXAXR5A13I34G4IDR8BRX17A
4AX2B2R2A2R6BR8AX3B4I4AX2BX4A12I9G2A25G4IBR9BX16A
4AR3BR2AR7BX8ARBRB4I4AR2BR4A12I9G2A25G4I4B3R4BR16A
4AR4B2R7BRAX7AR2BRD3I3AX4BX3A13I36G3IB3R3BR3BR16A
4AR12B2RXAXR5AR3BR3B3R2B2IDBRXB5I2B8I37G4A3IDRBRB4IB5RX5A
4AR11BR2A2R2BX4AR4B3R4B4I4B4ID2RD8I36G4A4IB2RB4I7BX4A
4AX11BR2AR3BR4AR8B2RD4IB2RB4I4B8I36G4A4IB2RB4ID5RBR4A
5AX5R6B2R5B4A3R5BRBD5IB2RB4IB2RB7I37G5A3IB2RB5ID6B4A
11AX7BRB7I3GR3BRD7IB2RB4I4G5I39G2RX5AR2BR3A9I4A
12AR5BRB8I4GRBRB8IB2RB4I4G4I13G2R25GR2BX4AR2BR4A8I4A
12A8B8I4GRBRD8IB2RB4I4G4I13G2R25GR2BR4AX2BX4A8I4A
12A4X4R7I5G2BDID6IDR2BRB3I5G2I41GR3BX2AXA2RAX3A7I5A
4N3K5A4K4N5I7G3IDID5BR4BR3B13G2K18G2K10G3IBR3BRXAX2RXAX2R4B5AXBR
4N4K4A4K4N4I8G4ID6R6BRBR12G4K16G4K8G4IBR5B2R2A2R3B2RBR4ARBDB
4N4K4A4K4N4I8G4I9B3R3BR12G4K16G4K8G4I4B3RBR2AR5BRBR4ARBDB
3NCL3K4A4K5N3I8G4IB2R5BR3B3R13G5K14G5K9G3IB3R3BRB2R5BR3B5AXBR
3KLFL6N4K11N5G4K3GR3BRB3I16G3I4K10G4K3I16G3IDR6BRB3I8A
4KL7N4K12N4G4K4GRBRB4I16G4I4K8G4K4I16G4IBR4BRB4I8A
4K8N4K12N4G4K4G3BD4I16G4I4K8G4K4I16G4I4B3RB4I8A
3K9N4K12N3G5K4G3XR3I17G4I4K8G4K4I17G3IB3R3B5I8A
12N4K5N12K3N4G4K20G4I4K6UHU4K4I24G4IOC2K4N4I
12N4K4N12K4N4G4K20G4I4K8U4K4I24G4IC3K4N4I
12N4K4N12K4N4G4K20G4I4K8U4K4I24G4I4KL3N4I
12N5K2N12KL4N3G5K20G4I4K8U4K4I24G4I3KLFL3N3I
12N13K11N5K10N13G4I16P4I17G14NFL2KL4N
5N2A5N12K12N4K12N5G2R5G4I16P4I16G16N4K4N
5N2A5N12K12N4K12N5G2R5G4I16P4I16G16N4K4N
11N13K11NFL2K14N11G3I18P3I15G17N4K4N
.2Q6N8K2.5K5N6KLF18N6G12P6T9P5G27N4K4N
3.Q4N8K4.4K4N8KL4N2I13N4G12P8T8P4G28N4K4N
4.4N8K4.4K4N8K5N2I13N4G12P8T8P4G28N4K4N
3.Q3N8K5.5K2NFL6K22N3G12P8T8P3G30N2KLF3N
4.9K7.7KLF16NY9U5N5P3T4K8T4K4U25N2A8NFL3K
4.8K8.8KL15NY11U4N4P4T4K8T4K4U24N4A8N4K
4.8K8.8K16N12U4N4P4T4K8T4K4U24N4A8N4K
3.8K9.7KL15NY13U3N3P5T4K8T4K4U24N4A8N4K
9K11.5KL15NY3U6P9U5T7I8T8I21N3IB3R8N4K
8K12.4K16NY3U8P8U4T8I8T8I20N4I3BR8N4K
8K12.4K16N4U8P8U4T8I8T8I20N4I3BR8N4K
7K12.KJ3K16N3U8P9U4T8I8T8I21N3I3R10N3K
5K4.2Q6.2KJK5.Q6NQ.Q4U12PU7P4T3V5I8K5I3V40N
4K4.Q2RQ4.4K7.Q4NQ2.Q4U9P2U9P4T4V4I8K4I4V40N
4K4.Q2RQ4.4K8.4N3.Q4U9P2U9P4T4V4I8K4I4V40N
4K5.2Q4.5K7Q.Q2NQ3.Q4U20P4T5V3I8K3I4V41N
4K9.7KM3R3IL7.Q4T20P4T21V24NQ4.Q6NQ4.Q.
4K8.8KX3B4IQ6.Q4T20P4T20V24NQ6.Q4NQ7.
4K8.8KXBRB4IQ7.4T20P4T20V24N8.4N8.
4K7.9KXB2R3IL5.3Q4T20P4T20V23NQ8.Q2NQ8.
4K5.8K3.4A.2Q5.L3U4T13P2T5P4T13V3I4U13NQ30.
4K4.8K3.Q4A7.Q4U4T12P4T4P4T12V4I4U12NQ31.
4K4.8K3.Q4AQ6.L4U4T12P4T4P4T12V4I4U12N32.
4K4.8K4.Q2AQ5.QL5U5T10P5T4P4T12V4I4U11NQ32.
4K4.8K5.2Q5.L4U3P7T6P7T4P4T12V4I4UQ.Q6NQ34.
4K4.8K11.Q4U4P8T4P8T4P4T12V4I4UQ2.Q4NQ35.
4K4.8K11.Q4U4P8T4P8T4P4T12V4I4UQ3.4N36.
4K4.8K9.2QL3U5P9T2P10T2P5T11V4IH3UL4.Q2NQ36.
4K4.8K8.Q8P31T9V4IH3ULQ45.
4K4.8K7.Q8P32T8V4IH3UL47.
4K4.8K7.Q8P32T8V4I4UQ47.
4K4.8K3Q4.Q7P33T8V4I4UQ4.6Q22.2Q13.
4K4.8KMRMQ3.Q5P35T8V4I4PQ3.QM2R3IL21.2IL12.
4K4.8KX2BMQ2.Q4P36T8V4I4PQ2.QM3B4IQ18.Q4IQ11.
4K4.8KX2BMQ2.Q4P36T8V4I4PQ2.QRBRB4IQ18.Q4IQ11.
4K4.8KMRMQ.3Q5P35T8V3I4PQ3.QRB2R3IL13.7Q4I.6Q5.
4K4.8K3Q.L6I4P14T2.17T8V5P2Q4.Q4A.2Q13.Q3I3RX4A4R3IL4.
4K4.8K3.Q8I4P12TJ2.J16T8V4PQ6.Q4A15.Q4ID3B4AR3B4IQ3.
4K4.8K3.Q8I4P12T4.16T8V4PQ6.Q4AQ14.Q4IDRBR4A3RB4IQ3.
4K4.8K3.Q8I4P11TJ4.16T8V4PQ7.Q2AQ16.L4ID2BX2AXR2B4IL4.
4WQ3.8K3.Q8I4V4T4K5.7K2.J6T3K2Q.Q8T9.2Q18.QL4ID4RB4ILQ5.
4WQ3.8K3.Q8I4V4T4K4.8K3.J4T4K4.8T31.L4IB2RB4IL7.
4WQ3.8K3.Q8I4V4T4K4.8K4.4T4K4.8T31.Q4I4B4IQ7.
5W2Q.8K3.Q7I5V4T4K4.7K5.4T4K4.8T17.2Q6.2Q4.Q4I4R4IL2Q5.
16WQ2.Q5I7VQ.Q.4K4.5K7.4T4K4.4T4K16.Q2IL4.Q2AQ3.Q4IL2Q.4I2RMQ4.
16WQ2.Q4I8V4.4K4.4K8.4T4K4.4T4K15.Q4IQ2.Q4AQ2.Q4IQ2.Q4IDBDMQ3.
16W4.4I8VQ3.4K4.4K8.4T4K4.4T4K15.L4IL3.4AQ2.Q4IQ2.Q4IBRBRQ3.
16W3QL4I7VQ4.4K4.4K8.3T5K4.4T4K3Q10.QL6IL2Q4A3.Q4IQ2.Q3IDR3BM3Q
16W4Y4E5V7.4K4.4K8.8K4.4T4KMRMQ8.Q11I12K3.QRDBRB2R2B3R
5W2A9W4Y4W4V8.4K4.4K8.8K4.4T4KX2BRQ6.Q5I2B5I12K3.QRBRBR2AR2BDB
5W2A8WE4YE3W4V8.4K4.4K8.8K4.4T4KX2BRQ6.Q5I2B5I12K3.QMD2BR2AR2BDB
W2E11WE6YEWE4VL7Q4K4.4K8.8K4.3T5KMRMQ8.L10IJ12K3Q.QMR2B2R2B3R
3IE4WE27Y4K4.4K8.8K4.8K3Q10.QL6IC3K2.Q3I5K3AQ.2QM4BM3Q
4I4W28Y4K4.4K8.8K4.8K15.L4IC3K3.Q4I4K4AQ2.QR2BRQ3.
4I4W28Y4K4.4K8.8K4.8K15.Q4I4K3.Q4I4K4AQ2.QM2DMQ3.
3IE4WE28Y3K4Q4K.6Q.8K4.8K9.3Q3.Q3IJ4K3.Q3I4K6A2Q.Q2RQ4.
3E2W2A12WE4IEWE6Y2W9Y12W8K4.8K8.QMRM9KMRMQ3.5K10AQ.2Q5.
4W4A12W4I3WE4YE2WE8Y12W8K4.8K7.QM2BX8KM2BRQ3.4K5A2R5AQ7.
4W4A11WE4IE3W4Y4W8YE11W8K4.8K7.QM2BX8KR2BRL3.4K5A2R5AQ7.
3W6A9WE6IEWE4YE2WE9YE11W7K.2Q.8K8.QMRM7KMB2RBMLQ2.3K11AQ5.3Q
11A5WE11I4Y4I5Y2A12YE3W5K4W8K9.3Q3.QM2X6BRMQ4.3Q6A.Q5.Q3A
5A2X5A4W5I2B5I4Y4I4Y4A12Y4W4K4W8K15.QRDBRB2IBRBDRQ6.Q4A7.Q4A
5A2R5A3WE5I2B5I4Y4I4Y4A12YE3W4K4W8K15.QMDBRB2IBRBDRQ6.Q4AQ6.Q4A
12A4W12I4Y4I4Y4A11YSYE3W2K5W8K16.QMR6BRMQ8.Q2AQ5.2Q.Q3A
3K6A9KJ6I3AEWEW12KXDBXE5WEYS2YE4WE6Y5K17.Q.MB2RBM2Q10.2Q5.Q2IL.3Q
4K4A11KJ4I4A4W12KX2DR7WE4Y4W8Y4K19.QR2BRQ18.Q4IQ3.
4K4A12KD3I4A4W12KX2BR8W4YE2WE8Y4K19.QM2DMQ18.Q4IQ3.
4K4A12KFD2I4A3WFW10KM4BX5WE6Y2W10Y3K15Q5.Q2RQ13.6Q.4I.3Q
4K8W3IJ15KWK7WM2X2B2R2B2RX17Y2A20YL5.2Q6.2Q5.Q3I3RX4AX3R
4K7WE4I16K8WBD2BR2AR2BDB16Y4A20YQ11.Q2RQ3.Q4ID3B4A2BDB
4K8W4I16K8WX3BR2AR2BDB16Y4A20YL11.Q2RQ3.Q4IDRBR4AR2BR
3K3WE4WE4IF16K4WE2WEXR2B2R2B2RX16Y4A21YL5Q6.2Q4.Q5ID2BX2AX2BDB
4WE3IRXRX4A4X4I4WMRM5K3IE3WX4BX29WE20YL9.6K4IDB2R2B3I
4W4I3BR4A4B4IE3WR2DM4K4I4WR2BR32W5Y2W13YQ7.8K4I4B4I
4W4IDRBR4ARBRB4IE2WER2BR4K4I4WX2BX32W5Y2W13YL7.8K4ID2BD4I
4WE4ID2BX2AX3B4IE2WEX4BM2KF3IE4WE2XE30WE22YL5Q2.7K4I4R4I
3A3WE4IDB2R2B4IE2WEXR2B2R2B2XME4W2A25WE38YL7.Q4IL2Q.4I
4A3WE4I4B4IE3WX3BR2AR2BDB4W4A9W2X13W40YQ6.Q4IQ2.Q4I
4A4W4ID3B4I4WX3BR2AR3BX4W4A9W2X13W40YL6.Q4IQ2.Q4I
3A4WE4IR2XR4IE3WEXR2B2R2BRXE3W6A23WE40YL5Q.Q2IL4.L3I
WE5WE4IE2WE4IE6WX4BX4W4A2X4A13WE2IE19WEX2BXE17WE8YL.2Q6.3Q
7WE4I4W4IE7WR2BR4W4AX2BX4A12W4I20WX2BR19WE8YQ11.
WE5WE4IE2WE4IE7WB2DB4W4AB2DB4A11WE4IE18WEB2DBE19W8YQ11.
7WE4I4W4I8WX2BR4W4AR2BR4A12W4I20WX2BX20W8YQ11.
`},art:`
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
 // ---- hi-res reveal art: optional `hires` per tapestry, HIRES_K x the gameplay grid ----
 // palette: space-separated tokens "<parent><rrggbb>" (parent = gameplay letter or '.' it belongs to);
 // data: one line per row, run-length encoded ("12a" = 12 x colour a). '.' = unstitched fabric.
 const HIRES_K=4,HIRES_ABC='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
 const hexRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
 const rgbHex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
 const hiresCache=new WeakMap();
 function decodeHires(p){
  if(!p||!p.hires)return null;if(hiresCache.has(p.hires))return hiresCache.get(p.hires);
  const k=p.hires.k||HIRES_K,w=p.w*k,h=p.h*k,toks=p.hires.palette.trim().split(/\s+/);
  const colors=toks.map(t=>'#'+t.slice(1)),parents=toks.map(t=>t[0]),idx=new Int16Array(w*h).fill(-1);
  const src=p.hires.data.replace(/\s+/g,'');let n=0,run='';
  for(const ch of src){if(ch>='0'&&ch<='9'){run+=ch;continue}const v=ch==='.'?-1:HIRES_ABC.indexOf(ch),r=run?+run:1;run='';
   if(v<-1||(ch!=='.'&&v<0)||v>=colors.length)throw Error('bad hires char '+ch+' in '+p.id);for(let j=0;j<r;j++)idx[n++]=v}
  if(n!==w*h)throw Error('hires size mismatch in '+p.id+': '+n+' != '+w*h);
  const out={k,w,h,colors,parents,idx,colorAt:(x,y)=>{const v=idx[y*w+x];return v<0?null:colors[v]},parentAt:(x,y)=>{const v=idx[y*w+x];return v<0?'.':parents[v]}};
  hiresCache.set(p.hires,out);return out}
 function encodeHires(w,h,idx,palette){const rows=[];
  for(let y=0;y<h;y++){let s='';for(let x=0;x<w;){const v=idx[y*w+x];let r=1;while(x+r<w&&idx[y*w+x+r]===v)r++;s+=(r>1?r:'')+(v<0?'.':HIRES_ABC[v]);x+=r}rows.push(s)}
  return{k:HIRES_K,palette:palette.map(e=>e.parent+e.hex.slice(1)).join(' '),data:rows.join('\n')}}
 // pixels: [[r,g,b],...] of size (p.w*K)x(p.h*K). Shades are clustered per gameplay colour so every
 // hi-res colour has a parent; a pixel may borrow another parent's shade only when clearly closer (cross penalty).
 function quantizeHires(p,pixels,o={}){
  const K=HIRES_K,w=p.w*K,h=p.h*K,total=Math.min(HIRES_ABC.length,o.colors??30),cross=o.cross??1.6,rng=mulberry32(o.seed??7);
  const parentOf=i=>p.rows[(i/w|0)/K|0][(i%w)/K|0],d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2,groups=new Map();
  pixels.forEach((px,i)=>{const c=parentOf(i);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(px)});
  const keys=[...groups.keys()],wsum=keys.reduce((s,c)=>s+Math.sqrt(groups.get(c).length),0),palette=[],bg=hexRgb(p.background);
  for(const c of keys){const pts=groups.get(c),m=Math.max(1,Math.min(7,Math.round(total*Math.sqrt(pts.length)/wsum)));
   // k-means++ seeded with the gameplay colour itself so the dominant shade stays recognisable
   const cent=[c==='.'?bg:hexRgb(p.palette[c])];
   while(cent.length<m){const ds=pts.map(q=>Math.min(...cent.map(z=>d2(q,z)))),sum=ds.reduce((a,b)=>a+b,0);if(!sum)break;let r=rng()*sum,i=0;while(i<pts.length-1&&(r-=ds[i])>0)i++;cent.push(pts[i].slice())}
   for(let it=0;it<10;it++){const acc=cent.map(()=>[0,0,0,0]);for(const q of pts){let b=0,bd=1e9;cent.forEach((z,j)=>{const d=d2(q,z);if(d<bd){bd=d;b=j}});acc[b][0]+=q[0];acc[b][1]+=q[1];acc[b][2]+=q[2];acc[b][3]++}
    acc.forEach((a,j)=>{if(a[3])cent[j]=[a[0]/a[3],a[1]/a[3],a[2]/a[3]]})}
   for(const z of cent){const hx=rgbHex(z);if(!palette.some(e=>e.parent===c&&e.hex===hx))palette.push({parent:c,hex:hx,rgb:hexRgb(hx)})}}
  palette.splice(HIRES_ABC.length);
  const idx=new Int16Array(w*h);
  pixels.forEach((px,i)=>{const c=parentOf(i);let b=0,bd=1e18;palette.forEach((e,j)=>{const d=d2(px,e.rgb)*(e.parent===c?1:cross);if(d<bd){bd=d;b=j}});idx[i]=b});
  // a background shade within ~18 RGB of the fabric colour is left unstitched
  const clear=palette.map(e=>e.parent==='.'&&d2(e.rgb,bg)<18*18*3);
  for(let i=0;i<idx.length;i++)if(clear[idx[i]])idx[i]=-1;
  // drop unused / cleared entries and renumber
  const used=[...new Set(idx)].filter(v=>v>=0).sort((a,b)=>a-b),map=new Map(used.map((v,j)=>[v,j]));
  for(let i=0;i<idx.length;i++)if(idx[i]>=0)idx[i]=map.get(idx[i]);
  return encodeHires(w,h,idx,used.map(v=>palette[v]))}
 // every gameplay cell's 4x4 block must be dominated by shades of that cell's colour
 function hiresCheck(p,hires){const q={...p,hires},hr=decodeHires(q),bad=[];let n=0;
  for(let y=0;y<p.h;y++)for(let x=0;x<p.w;x++){const want=p.rows[y][x],cnt={};
   for(let j=0;j<hr.k;j++)for(let i=0;i<hr.k;i++){const c=hr.parentAt(x*hr.k+i,y*hr.k+j);cnt[c]=(cnt[c]||0)+1}
   const top=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];n++;if(top!==want)bad.push({x,y,want,got:top})}
  return{ratio:n?1-bad.length/n:1,bad}}
 // write/replace `hires:{...}` inside one TAP entry of logic.js source text
 function applyHiresEntry(text,id,hires){const start=text.indexOf("{id:'"+id+"'");if(start<0)throw Error('tapestry '+id+' not found');
  const artAt=text.indexOf('art:`',start);if(artAt<0)throw Error('art of '+id+' not found');
  const field="hires:{k:"+hires.k+",palette:'"+hires.palette+"',data:`\n"+hires.data+"\n`},";
  const head=text.slice(start,artAt),old=head.indexOf('hires:{');
  if(old>=0){const end=text.indexOf('`},',start+old+text.slice(start+old).indexOf('data:`')+6)+3;return text.slice(0,start+old)+field+text.slice(end)}
  return text.slice(0,artAt)+field+text.slice(artAt)}
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

 return{HIRES_K,decodeHires,encodeHires,quantizeHires,hiresCheck,applyHiresEntry,applyMiniOverride,trapCount,colorComps,adj,splitLevel,levelFromBaked,spoolText,TRAP_TARGET,DIFF_NAME,DIFF_HEARTS,COLORS,regionSize,strandInfo,makePictures,generateTapestry,DIFFICULTY,mulberry32,makeState,neighbors,cell,remaining,lengths,solveCells,solveColor,solve,isSolvable,legalNext,validStarts,analyzeSpool,countPartitions,botSim,humanSim,failTarget,pathStatus,autoRun,autoStitch,ASSIST,FIXTURE,MOTIFS,parseLevel,generateLevels,metrics};
})();
if(typeof module!=='undefined')module.exports=Logic;
