import '../src/env.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvaluationResult, deterministicCheck, rankPassages, splitSentences } from '../src/services/verification-engine.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const withAI=process.argv.includes('--ai');
const heldoutMode=process.argv.includes('--heldout');
if(withAI&&heldoutMode) {
  console.error('Held-out cases cannot be sent to an AI provider. Run deterministic mode only.');
  process.exitCode=2;
} else {
  const fixtures=heldoutMode?await loadHeldout():JSON.parse(await readFile(path.join(here,'fixtures.json'),'utf8'));
  const results=fixtures.map((fixture)=>{
    const sentence=splitSentences(fixture.draft)[0];
    const passage={passageId:`passage-${fixture.id}`,sourceId:`source-${fixture.id}`,version:1,name:`Invented ${fixture.id}`,text:fixture.source};
    const retrieved=rankPassages(sentence.text,[passage]);
    const actual=deterministicCheck(sentence.text,retrieved).verdict;
    return {id:fixture.id,expected:fixture.expected,actual,categories:fixture.categories||[]};
  });
  printEvaluation(heldoutMode?'Held-out deterministic evaluation':'Deterministic evaluation',results);
  if(results.some((item)=>item.expected!==item.actual)&&!heldoutMode)process.exitCode=1;
  if(withAI)await evaluateAI(fixtures);
}

async function loadHeldout() {
  const directory=path.join(here,'heldout');
  const files=(await readdir(directory)).filter((file)=>file.endsWith('.json')).sort();
  const cases=[];
  for(const file of files)cases.push(...JSON.parse(await readFile(path.join(directory,file),'utf8')));
  if(!cases.length)throw new Error('No held-out JSON cases were found.');
  return cases;
}

function printEvaluation(title,cases) {
  const categories={};
  for(const item of cases)for(const category of item.categories)categories[category]=(categories[category]||0)+1;
  const correct=cases.filter((item)=>item.expected===item.actual).length;
  console.log(`${title} (invented fixtures only)`);
  console.log(JSON.stringify({count:cases.length,casesByCategory:categories,...buildEvaluationResult(cases)},null,2));
  console.log(`Correct: ${correct}/${cases.length}`);
}

async function evaluateAI(fixtures) {
  if(!process.env.GEMINI_API_KEY) {
    console.error('AI evaluation requires GEMINI_API_KEY. Deterministic mode only uses invented fixtures and is always available.');
    process.exitCode=2;
    return;
  }
  const {evaluateInventedFixture}=await import('../src/services/verification.js');
  const aiResults=[];
  for(const fixture of fixtures) {
    const findings=await evaluateInventedFixture({draft:fixture.draft,passages:[{passageId:`passage-${fixture.id}`,sourceId:`source-${fixture.id}`,version:1,name:`Invented ${fixture.id}`,text:fixture.source}]});
    aiResults.push({id:fixture.id,expected:fixture.expected,actual:findings[0]?.verdict||'Not enough evidence',categories:fixture.categories||[]});
  }
  printEvaluation('AI-assisted evaluation',aiResults);
}
