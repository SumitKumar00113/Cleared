import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { deterministicCheck, mergeVerdicts, rankPassages, splitSentences } from '../src/services/verification-engine.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixtures=JSON.parse(await readFile(path.join(here,'../eval/fixtures.json'),'utf8'));

test('deterministic evaluation set meets its minimum accuracy threshold',()=>{
  const outcomes=fixtures.map((fixture)=>{
    const sentence=splitSentences(fixture.draft)[0];
    const passages=rankPassages(sentence.text,[{passageId:fixture.id,sourceId:`source-${fixture.id}`,version:1,name:'Invented source',text:fixture.source}]);
    const actual=deterministicCheck(sentence.text,passages).verdict;
    return {id:fixture.id,expected:fixture.expected,actual};
  });
  const correct=outcomes.filter((item)=>item.expected===item.actual).length;
  assert.ok(correct/fixtures.length>=0.9,JSON.stringify(outcomes.filter((item)=>item.expected!==item.actual)));
  assert.ok(fixtures.filter((fixture)=>fixture.categories?.includes('prompt_injection')).length>=10,'the fixed evaluation set retains at least ten prompt-injection fixtures');
});

test('held-out evaluation has at least fifteen separate cases and never enters the fixed threshold set',async()=>{
  const heldout=JSON.parse(await readFile(path.join(here,'../eval/heldout/v1.json'),'utf8'));
  assert.ok(heldout.length>=15);
  const ids=new Set(fixtures.map((fixture)=>fixture.id));
  assert.ok(heldout.every((fixture)=>!ids.has(fixture.id)));
});

test('deterministic numeric contradiction cannot be upgraded by an AI Supported result',()=>{
  const sentence='Northstar approval rate is 5%.';
  const passage={passageId:'p1',sourceId:'s1',version:1,name:'Northstar policy',text:'Northstar approval rate is 3%.'};
  const deterministic=deterministicCheck(sentence,rankPassages(sentence,[passage]));
  assert.equal(deterministic.verdict,'Contradicted');
  const merged=mergeVerdicts(deterministic,{verdict:'Supported',evidence:'Northstar approval rate is 3%.'});
  assert.equal(merged.verdict,'Contradicted');
  assert.equal(merged.evidence,'Northstar approval rate is 3%.');
});

test('uncovered sentences are deterministic and do not gain a retrieval passage',()=>{
  const sentence='Juniper has three offices in Iceland.';
  assert.deepEqual(rankPassages(sentence,[{passageId:'p1',text:'Approved brand sources are kept in collections.'}]),[]);
  assert.equal(deterministicCheck(sentence,[]).verdict,'Not enough evidence');
});

test('deterministic checks detect conflicting currency symbols and retain exact source evidence',()=>{
  for(const [currency,claim,source] of [
    ['USD','Atlas budget is $800.','Atlas budget is $500.'],
    ['EUR','Boreal budget is €800.','Boreal budget is €500.'],
    ['GBP','Cedar budget is £800.','Cedar budget is £500.'],
    ['INR','Delta budget is ₹800.','Delta budget is ₹500.'],
  ]) {
    const passage={passageId:`p-${currency}`,sourceId:`s-${currency}`,version:1,name:'Invented budget',text:source};
    const result=deterministicCheck(claim,rankPassages(claim,[passage]));
    assert.equal(result.verdict,'Contradicted',currency);
    assert.equal(result.evidence,source,currency);
    assert.equal(result.passageId,passage.passageId,currency);
  }
});
