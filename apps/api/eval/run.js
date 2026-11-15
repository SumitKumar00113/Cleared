import '../src/env.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvaluationResult, deterministicCheck, rankPassages, splitSentences } from '../src/services/verification-engine.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixtures=JSON.parse(await readFile(path.join(here,'fixtures.json'),'utf8'));
const withAI=process.argv.includes('--ai');
const deterministic=fixtures.map((fixture)=>{
    const sentence=splitSentences(fixture.draft)[0];
    const passage={passageId:`passage-${fixture.id}`,sourceId:`source-${fixture.id}`,version:1,name:`Invented ${fixture.id}`,text:fixture.source};
    const retrieved=rankPassages(sentence.text,[passage]);
    const actual=deterministicCheck(sentence.text,retrieved).verdict;
    return {id:fixture.id,expected:fixture.expected,actual};
  });
  console.log('Deterministic evaluation (invented fixtures only)');
  console.log(JSON.stringify(buildEvaluationResult(deterministic),null,2));
  console.log(`Correct: ${deterministic.filter((item)=>item.expected===item.actual).length}/${deterministic.length}`);
  if(deterministic.some((item)=>item.expected!==item.actual))process.exitCode=1;
if(withAI&&!process.env.GEMINI_API_KEY) {
  console.error('AI evaluation requires GEMINI_API_KEY. Deterministic mode only uses invented fixtures and is always available.');
  process.exitCode=2;
} else if(withAI) {
    const {evaluateInventedFixture}=await import('../src/services/verification.js');
    const aiResults=[];
    for(const fixture of fixtures) {
      const findings=await evaluateInventedFixture({draft:fixture.draft,passages:[{passageId:`passage-${fixture.id}`,sourceId:`source-${fixture.id}`,version:1,name:`Invented ${fixture.id}`,text:fixture.source}]});
      aiResults.push({id:fixture.id,expected:fixture.expected,actual:findings[0]?.verdict||'Not enough evidence'});
    }
    console.log('AI-assisted evaluation (invented fixtures only)');
    console.log(JSON.stringify(buildEvaluationResult(aiResults),null,2));
    console.log(`Correct: ${aiResults.filter((item)=>item.expected===item.actual).length}/${aiResults.length}`);
}
