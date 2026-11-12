const fs=require('node:fs'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/logic.js','utf8');
const Logic=Function(src+'\nreturn Logic')();
const t0=Date.now();

// Moon 3/8: equal remaining cell/spool totals can still have no valid paths.
{
 const pic=Logic.makePictures().find(p=>p.id==='moon'),i=2;
 const lv=Logic.levelFromBaked(pic.first+i,'Moon 3/8',pic.piece(i),pic.baked[i]);
 const spools=lv.spools.map(s=>({...s})),spool=spools.find(s=>s.color==='B'&&s.length===4);
 for(const path of [[18,26,34,42],[18,26,34,33]]){
  spool.done=true;
  const state=Logic.makeState(lv,new Set(path),spools),info=Logic.strandInfo(state,'B');
  assert.equal(Logic.solveColor(state,'B').status,'unsolvable');
  assert.equal(info.kind,path.at(-1)===42?'shape':'size');
  assert.deepEqual(info.lens,[15,11]);
  assert.deepEqual(info.groups.map(g=>g.length),info.sizes);
  assert.deepEqual(info.groups.flat().sort((a,b)=>a-b),info.cells.slice().sort((a,b)=>a-b));
  assert.equal(info.cells.length,26);
 }
}

// 1. Level 1 fixture (spec section 3)
const fx=Logic.parseLevel(Logic.FIXTURE.name,Logic.FIXTURE.rows,1);
fx.spools=Logic.FIXTURE.spools.map((s,id)=>({...s,id,done:false}));
const st=Logic.makeState(fx),rc=ids=>ids.map(i=>[i/fx.w|0,i%fx.w]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
assert.equal(Logic.isSolvable(st),'solvable');
assert.deepEqual(rc(Logic.validStarts(st,fx.spools[0])),[[0,2],[2,1]],'red starts');
assert.deepEqual(rc(Logic.validStarts(st,fx.spools[1])),[[0,3],[1,1]],'green starts');
assert.equal(Logic.legalNext(st,[0],1,'R'),true);
assert.equal(Logic.legalNext(st,[0],5,'R'),false,'green cell not legal for red');
assert.equal(Logic.legalNext(st,[0,1],0,'R'),false,'no revisit');

// 2. Solver vs independent brute force on random small grids
function brute(w,h,cells,lens){const set=new Set(cells);if(!lens.length)return set.size===0;
 const [L,...rest]=lens;const nb=i=>[i%w?i-1:-1,i%w<w-1?i+1:-1,i-w,i+w].filter(j=>j>=0&&j<w*h);
 for(const s of set){const path=[s];const go=()=>{if(path.length===L){const next=new Set(set);path.forEach(i=>next.delete(i));return brute(w,h,[...next],rest)}
  for(const n of nb(path[path.length-1]))if(set.has(n)&&!path.includes(n)){path.push(n);if(go()){path.pop();return true}path.pop()}return false};if(go())return true}return false}
const rng=Logic.mulberry32(12345);let agree=0,solv=0;
for(let t=0;t<400;t++){const w=3+(rng()*2|0),h=3,cells=[];for(let i=0;i<w*h;i++)if(rng()<.7)cells.push(i);if(!cells.length)continue;
 const lens=[];let left=cells.length;while(left){const l=Math.min(left,1+(rng()*4|0));lens.push(l);left-=l}
 if(rng()<.3&&lens.length>1){lens[0]++;lens[1]--;if(!lens[1])lens.pop()}
 const a=Logic.solveCells(w,h,cells,lens).status,b=brute(w,h,cells,lens)?'solvable':'unsolvable';
 assert.equal(a,b,`solver vs brute: ${w}x${h} cells=${cells} lens=${lens}`);agree++;if(a==='solvable')solv++}
console.log(`solver == brute force on ${agree} random cases (${solv} solvable)`);

// 2b. Drawing assists on the fixture
assert.equal(Logic.pathStatus(st,fx.spools[0],[0]),'doomed','red from (0,0) can never finish');
assert.equal(Logic.pathStatus(st,fx.spools[0],[2]),'ok');
assert.deepEqual(Logic.autoRun(st,fx.spools[0],[2]),[1,0,4,8,9],'corridor runs itself');
assert.deepEqual(Logic.autoRun(st,fx.spools[1],[5]),[6],'runs one cell then stops at the branch');
{const p=Logic.autoStitch(st,fx.spools[0]);assert.equal(p.length,6);assert([2,9].includes(p[0]));assert.equal(Logic.pathStatus(st,fx.spools[0],p),'ok')}

// 3. Twenty generated levels
const levels=Logic.generateLevels();assert.equal(levels.length,20);
for(const [i,[name,art]] of Logic.MOTIFS.entries()){
 assert(art.every(row=>row.length===art[0].length&&[...row].every(c=>c==='.'||c==='#'||Logic.COLORS.includes(c))),`art grid ${name}`);
 assert.equal(levels[i+1].cells.join('').toUpperCase(),art.join(''),`level matches art ${name}`);
}
const rows=[];
for(const l of levels){
 const n=l.cells.filter(x=>Logic.COLORS.includes(x)).length;
 assert(l.spools.length<=12,`tray size L${l.number}: ${l.spools.length}`);
 assert.equal(l.spools.reduce((a,s)=>a+s.length,0),n,`spool total L${l.number}`);
 for(const {color,path} of l.solution){assert(path.every(i=>l.cells[i]===color),`color L${l.number}`);
  assert(path.every((i,k)=>!k||Logic.neighbors(l,path[k-1]).includes(i)),`adjacent L${l.number}`);assert.equal(new Set(path).size,path.length)}
 assert.equal(Logic.isSolvable(Logic.makeState(l)),'solvable',`solvable L${l.number}`);
 const m=Logic.metrics(l);rows.push({...m,botFail300:+Logic.botSim(l,300,999).toFixed(2),target:+Logic.failTarget(l.number).toFixed(2),size:l.w+'x'+l.h,name:l.name,anchors:l.prestitch.size,torn:l.cells.filter(x=>x==='#').length,minLen:Math.min(...l.spools.map(s=>s.length))});
}
console.table(rows);
// difficulty-table checks (reported, soft where the spec says "about"/"target")
const warn=[];
for(const r of rows){const L=r.level,[w,h]=r.size.split('x').map(Number);
 if(L<=5&&(r.colors<2||r.colors>3))warn.push(`L${L} colors ${r.colors} (want 2-3)`);
 if(L>=6&&L<=15&&(r.colors<3||r.colors>5))warn.push(`L${L} colors ${r.colors} (want 3-5)`);
 if(L>=16&&(r.colors<4||r.colors>6))warn.push(`L${L} colors ${r.colors} (want 4-6)`);
 if(L>=6&&r.rejectedRatio<.3)warn.push(`L${L} rejectedRatio ${r.rejectedRatio} (<0.3 target)`);
 if(L>=6&&r.solutions<2&&false)warn.push(`L${L} unique solution`)}
console.log(warn.length?'SOFT WARNINGS:\n - '+warn.join('\n - '):'all soft targets met');

// 3b. Tapestries (big pictures cut into pieces) + UX helpers
{const tap=Logic.generateTapestry(),pics=Logic.makePictures();assert.equal(tap.length,pics.reduce((a,p)=>a+p.count,0));
 assert.deepEqual(pics.map(p=>[p.id,p.w,p.h,p.first,p.count]),[
  ['duck',24,24,21,9],['moon',16,32,30,8],['cottage',24,40,38,15],['jelly',24,32,53,12],['fox',32,32,65,16]
 ],'tapestry sizes and progression order');
 for(const p of pics){assert(p.rows.every(row=>row.length===p.w&&[...row].every(c=>c==='.'||Logic.COLORS.includes(c))),`art grid ${p.id}`);
  for(let i=0;i<p.count;i++){const l=tap[p.first-21+i],x=i%p.cols*8,y=Math.floor(i/p.cols)*8;
   const pixels=p.rows.slice(y,y+8).map(row=>row.slice(x,x+8)).join('');
   assert.equal(l.cells.join('').toUpperCase(),pixels,`piece matches finished art L${l.number}`)}}
 for(const l of tap){const n=l.cells.filter(x=>Logic.COLORS.includes(x)).length;assert.equal(l.spools.reduce((a,s)=>a+s.length,0),n,'tap spool total '+l.number);
  assert(l.spools.length>0&&l.spools.every(s=>s.length>=2),`playable threads L${l.number}`);
  assert.equal(Logic.isSolvable(Logic.makeState(l)),'solvable','tap solvable '+l.number);assert(l.spools.length<=12,'tray size '+l.number+': '+l.spools.length)}
 console.log('tapestry pieces:',tap.length,'solvable; spools per piece',tap.map(l=>l.spools.length).join(','));
 // region size + strand explanation on the fixture
 assert.equal(Logic.regionSize(st,'R',2),6);assert.equal(Logic.regionSize(st,'G',5),6);
 const st2=Logic.makeState(fx,new Set([0,1,2]),[{color:'R',length:3,done:true},{color:'R',length:3,done:false},fx.spools[1]]);
 const st3=Logic.makeState(fx,new Set([2,1,0,4,8]),[{color:'R',length:5,done:true},{color:'R',length:2,done:false}]);
 const s3=Logic.strandInfo(st3,'R');assert.deepEqual(s3.cells,[9]);assert.equal(s3.kind,'size');
 const s4=Logic.strandInfo(Logic.makeState(fx,new Set([2,1,0,4,8,9]),[{color:'R',length:6,done:true}]),'R');assert.equal(s4.cells.length,0);}

// UI regression: a dead end must not poison a different route of the same length.
{
 const vm=require('node:vm'),html=fs.readFileSync(__dirname+'/index.html','utf8');
 const extract=(name,next)=>html.slice(html.indexOf('function '+name+'('),html.indexOf('function '+next+'('));
 const lv=Logic.parseLevel('Branch',['.R.','RRR','.RR'],99),spool={id:0,color:'R',length:6,done:false};
 lv.spools=[spool];
 const noop=()=>{},ctx={Logic,level:lv,game:{stitched:new Set(),spools:[spool]},selected:spool,parked:null,screen:'game',
  settings:{reduced:true},stitchTimes:new Map(),performance:{now:()=>100},pitchBase:()=>0,cellCenter:()=>({x:0,y:0}),
  play:noop,vibrate:noop,spark:noop,showTip:noop,updateUI:noop,CONFIG:{heartOnDeadEnd:false},stat:()=>({deadEnds:0}),
  toastUntil:0,cutMode:false,app:{classList:{toggle:noop}},commitPath:()=>{throw Error('unexpected commit')}};
 vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function currentPathStuck('),html.indexOf('const ICONS=')),ctx);
 ctx.refreshBadges=()=>{ctx.instruction=ctx.instructionText()};
 vm.runInContext(extract('enterCell','nearestCell')+extract('deadEnd','resize')+extract('pullBack','swipeStep'),ctx);
 [3,4,1].forEach(i=>ctx.enterCell(i));
 assert.equal(ctx.currentPathStuck(),true,'real dead end');
 assert.equal(ctx.instructionText(),'Stuck \u2013 take a stitch back');
 ctx.enterCell(4);ctx.enterCell(5);
 assert.equal(ctx.parked.path.length,3);
 assert.equal(ctx.currentPathStuck(),false,'rewind and turn at same length');
 assert.equal(ctx.instruction,'3 more','instruction refresh clears warning immediately');
 assert(Logic.legalNext(Logic.makeState(lv),ctx.parked.path,8,'R'),'down remains available');
 ctx.enterCell(4);ctx.enterCell(1);ctx.pullBack();ctx.enterCell(7);
 assert.equal(ctx.currentPathStuck(),false,'undo button and alternate branch');
 ctx.parked=null;ctx.enterCell(3);ctx.enterCell(4);ctx.enterCell(5);
 assert.equal(ctx.currentPathStuck(),false,'cancel and restart at same length');
 ctx.game.stitched.add(8);
 assert.equal(ctx.currentPathStuck(),true,'committed stitches block forward moves');
 ctx.game.stitched.clear();
 ctx.parked.spool={...spool,length:3};
 assert.equal(ctx.currentPathStuck(),false,'completed spool is not a dead end');
 ctx.parked=null;
 assert.equal(ctx.currentPathStuck(),false,'no active path');
 console.log('UI dead-end regression checks passed');
}

// 4. index.html carries the same logic block
if(fs.existsSync(__dirname+'/index.html')){const html=fs.readFileSync(__dirname+'/index.html','utf8'),blk=html.split('// BEGIN PURE LOGIC')[1]?.split('// END PURE LOGIC')[0];
 console.log(blk&&blk.trim()===src.trim()?'index.html logic block is in sync':'WARNING: index.html logic block differs from logic.js - run node build.js')}
console.log(`PASS in ${Date.now()-t0} ms`);
