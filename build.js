// Splices logic.js (source of truth for rules/solver/generator) into index.html between the markers.
const fs=require('node:fs'),f=__dirname+'/index.html',html=fs.readFileSync(f,'utf8');
const a=html.indexOf('// BEGIN PURE LOGIC'),b=html.indexOf('// END PURE LOGIC');
if(a<0||b<0)throw Error('markers missing in index.html');
fs.writeFileSync(f,html.slice(0,a)+'// BEGIN PURE LOGIC\n'+fs.readFileSync(__dirname+'/logic.js','utf8').trim()+'\n'+html.slice(b));
console.log('logic.js spliced into index.html');
