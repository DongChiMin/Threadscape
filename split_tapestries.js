// Level designer tool: choose a difficulty per tapestry (or per piece), let the solver split the spools, bake the result into logic.js.
//
//   node split_tapestries.js                       report only (all tapestries, current difficulty), nothing written
//   node split_tapestries.js fox moon              report only for these
//   node split_tapestries.js fox --diff 4 --write  set fox to difficulty 4, re-split, bake into logic.js (then run: node build.js)
//   node split_tapestries.js fox --pieces 3:5,7:2  per-piece overrides (piece number 1-based : difficulty), with --write
//
// Difficulty 1..5 = target "trap rate": the share of random legal commits that strand cells and cost a heart
// (1 easy ~3%, 2 ~15%, 3 ~35%, 4 ~60%, 5 ~85%). How low/high a piece can really go depends on its art, so the report also
// shows the reachable range [min-max] for every piece. Edit the art in logic.js (TAP), re-run, repeat.
const fs=require('node:fs'),F=__dirname+'/logic.js';
const args=process.argv.slice(2),write=args.includes('--write'),flag=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:null};
const diffArg=flag('--diff')?+flag('--diff'):null,piecesArg=flag('--pieces');
const ids=args.filter((a,i)=>!a.startsWith('--')&&args[i-1]!=='--diff'&&args[i-1]!=='--pieces');
let src=fs.readFileSync(F,'utf8');
const L=Function(src+'\nreturn Logic')();
if(diffArg!=null&&!(diffArg>=1&&diffArg<=5))throw Error('--diff must be 1..5');
const over={};if(piecesArg)for(const kv of piecesArg.split(',')){const [p,d]=kv.split(':').map(Number);if(!(p>=1)||!(d>=1&&d<=5))throw Error('bad --pieces '+kv);over[p-1]=d}
const pics=L.makePictures().filter(p=>!ids.length||ids.includes(p.id));
if(!pics.length)throw Error('no tapestry matches '+ids.join(','));
let changed=0;
for(const pic of pics){
 const base=diffArg??pic.diff??3,diffs=Array.from({length:pic.count},(_,i)=>over[i]??pic.diffs?.[i]??base),lines=[];
 console.log(`\n${pic.name} (${pic.id}) ${pic.w}x${pic.h}, ${pic.count} pieces, difficulty ${diffArg??pic.diff??3}`);
 console.log(' piece diff  trap  target  reachable   spools  hearts  split');
 for(let i=0;i<pic.count;i++){const t=Date.now(),lv=L.splitLevel(pic.piece(i),{diff:diffs[i],seed:pic.first+i,name:pic.name+' '+(i+1)+'/'+pic.count,number:pic.first+i});
  lines.push(L.spoolText(lv));
  console.log(` ${String(i+1).padStart(3)}   ${diffs[i]}    ${lv.trap.toFixed(2)}  ${lv.trapTarget.toFixed(2)}    ${lv.trapRange[0].toFixed(2)}-${lv.trapRange[1].toFixed(2)}     ${String(lv.spools.length).padStart(2)}      ${L.DIFF_HEARTS[diffs[i]]}     ${L.spoolText(lv)}`)}
 if(write){
  const a=src.indexOf("{id:'"+pic.id+"'");if(a<0)throw Error('entry not found '+pic.id);
  let e=src.indexOf("\n`",src.indexOf('art:`',a));if(e<0)throw Error('art end');
  let end=src.indexOf('}',e+2);let entry=src.slice(a,end+1);
  entry=entry.replace(/,spools:`[\s\S]*?`/,'');
  entry=entry.replace(/\n`\}$/,'\n`,spools:`\n'+lines.join('\n')+'\n`}');
  entry=entry.replace(/diff:\d+/,'diff:'+(diffArg??pic.diff??3));
  if(piecesArg||pic.diffs){const arr=diffs.join(',');entry=/diffs:\[[^\]]*\]/.test(entry)?entry.replace(/diffs:\[[^\]]*\]/,'diffs:['+arr+']'):entry.replace(/diff:(\d+)/,'diff:$1,diffs:['+arr+']')}
  src=src.slice(0,a)+entry+src.slice(end+1);changed++}
}
if(write){fs.writeFileSync(F,src);console.log('\nwrote',changed,'tapestries into logic.js - now run: node build.js && node test_logic.js')}
else console.log('\n(report only - add --write to bake these splits into logic.js)');
