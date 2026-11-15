const STOP_WORDS=new Set('a an and are as at be by for from has have in is it of on or that the this to was were will with'.split(' '));
const GENERIC_CAPITALS=new Set(['A','An','And','But','Check','Change','Disregard','Fake','Forget','Ignore','Pretend','Return','Role','System','The']);
const RETRIEVAL_THRESHOLD=0.55;

export function stripControlCharacters(value) { return String(value||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,''); }
export function splitSentences(text) {
  return stripControlCharacters(text).replace(/\r/g,'\n').split(/(?<=[.!?])\s+|\n+/).map((text)=>text.trim()).filter(Boolean).map((text,index)=>({id:`s${index+1}`,text}));
}
function words(text) { return (String(text||'').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter((word)=>!STOP_WORDS.has(word)); }
export function rankPassages(query,passages,{limit=3,threshold=RETRIEVAL_THRESHOLD}={}) {
  const queryWords=[...new Set(words(query))];
  if(!queryWords.length||!passages.length)return [];
  const docs=passages.map((passage)=>words(passage.text));
  const avgLen=docs.reduce((sum,doc)=>sum+doc.length,0)/docs.length||1;
  const ranked=passages.map((passage,index)=>{
    const doc=docs[index],score=queryWords.reduce((total,term)=>{
      const tf=doc.filter((word)=>word===term).length;
      if(!tf)return total;
      const df=docs.filter((other)=>other.includes(term)).length;
      const idf=Math.log(1+(docs.length-df+0.5)/(df+0.5));
      return total+idf*(tf*2.2)/(tf+1.2*(0.25+0.75*doc.length/avgLen));
    },0);
    return {...passage,score};
  }).filter((passage)=>passage.score>=threshold).sort((a,b)=>b.score-a.score||String(a.passageId).localeCompare(String(b.passageId)));
  return ranked.slice(0,limit);
}

function factAtoms(text) {
  const input=String(text||'');
  const atoms=[];
  for(const match of input.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(%|percent(?:age)?)/gi)) atoms.push({type:'percent',value:Number(match[1].replace(',','.'))});
  for(const match of input.matchAll(/([\p{Sc}])\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gu)) atoms.push({type:`currency_${match[1]}`,value:Number(match[2].replaceAll(',',''))});
  for(const match of input.matchAll(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|(?:19|20)\d{2})\b/gi)) atoms.push({type:'date',value:match[1].toLowerCase().replace(/\s+/g,' ')});
  for(const match of input.matchAll(/\b(\d+(?:[.,]\d+)?)\b/g)) {
    const number=Number(match[1].replace(',','.'));
    if(!atoms.some((atom)=>atom.value===number))atoms.push({type:'number',value:number});
  }
  return atoms;
}
function namedSlots(text) {
  const slots=[];
  for(const match of String(text||'').matchAll(/\b(in|at|from|to)\s+([A-Z][\p{L}\p{N}-]*)/gu))slots.push({cue:match[1].toLowerCase(),value:match[2].toLowerCase()});
  for(const match of String(text||'').matchAll(/\b(company|brand|product|customer|vendor|partner|team|location)\s+(?:name\s+)?(?:is|:|called)\s+([A-Z][\p{L}\p{N}-]*)/giu))if(/^[A-Z]/.test(match[2]))slots.push({cue:match[1].toLowerCase(),value:match[2].toLowerCase()});
  return slots;
}
function sourceQuoteForAtom(passage,atom) {
  const sentences=splitSentences(passage.text);
  return sentences.find((item)=>factAtoms(item.text).some((sourceAtom)=>sourceAtom.type===atom.type&&sourceAtom.value!==atom.value))?.text||passage.text;
}
function normalized(text) { return String(text||'').toLocaleLowerCase().replace(/[^\p{L}\p{N}%\p{Sc}]+/gu,' ').trim(); }
export function namedTerms(text) { return [...new Set((String(text||'').match(/\b(?:[A-Z][a-z][\p{L}\p{N}-]*|[A-Z]{2,})\b/gu)||[]).filter((term)=>!GENERIC_CAPITALS.has(term)))]; }
export function evidenceCoversNamedTerms(claim,evidence) { const lower=String(evidence||'').toLocaleLowerCase();return namedTerms(claim).every((term)=>lower.includes(term.toLocaleLowerCase())); }
export function deterministicCheck(sentence,rankedPassages) {
  const exact=rankedPassages.find((passage)=>normalized(passage.text).includes(normalized(sentence)));
  if(exact)return {verdict:'Supported',evidence:sentence,sourceId:exact.sourceId,sourceName:exact.name,sourceVersion:exact.version,passageId:exact.passageId,explanation:'The sentence appears verbatim in an approved source passage.',mode:'deterministic'};
  const claimAtoms=factAtoms(sentence);
  for(const passage of rankedPassages) {
    const sourceAtoms=factAtoms(passage.text);
    const conflict=claimAtoms.find((atom)=>sourceAtoms.some((sourceAtom)=>sourceAtom.type===atom.type&&sourceAtom.value!==atom.value));
    if(conflict)return {verdict:'Contradicted',evidence:sourceQuoteForAtom(passage,conflict),sourceId:passage.sourceId,sourceName:passage.name,sourceVersion:passage.version,passageId:passage.passageId,explanation:`The approved passage contains a conflicting ${conflict.type==='date'?'date':conflict.type==='percent'?'percentage':conflict.type.startsWith('currency_')?'currency value':'number'}.`,mode:'deterministic'};
    const claimSlot=namedSlots(sentence).find((item)=>namedSlots(passage.text).some((sourceSlot)=>sourceSlot.cue===item.cue&&sourceSlot.value!==item.value));
    if(claimSlot) {
      const sourceSlot=namedSlots(passage.text).find((item)=>item.cue===claimSlot.cue&&item.value!==claimSlot.value);
      const evidence=splitSentences(passage.text).find((item)=>namedSlots(item.text).some((slot)=>slot.cue===claimSlot.cue&&slot.value===sourceSlot.value))?.text||passage.text;
      return {verdict:'Contradicted',evidence,sourceId:passage.sourceId,sourceName:passage.name,sourceVersion:passage.version,passageId:passage.passageId,explanation:'The approved passage names a different value for the same named term.',mode:'deterministic'};
    }
  }
  return {verdict:'Not enough evidence',evidence:null,sourceId:null,sourceName:null,sourceVersion:null,passageId:rankedPassages[0]?.passageId||null,explanation:rankedPassages.length?'The retrieved passages do not establish this sentence.':'No approved source passage matched this sentence.',mode:'deterministic'};
}
export function mergeVerdicts(deterministic,modelFinding) {
  const severity={'Supported':0,'Not enough evidence':1,'Contradicted':2};
  const modelVerdict=['Supported','Not enough evidence','Contradicted'].includes(modelFinding?.verdict)?modelFinding.verdict:'Not enough evidence';
  const verdict=severity[deterministic.verdict]>=severity[modelVerdict]?deterministic.verdict:modelVerdict;
  const chosen=verdict===deterministic.verdict?deterministic:modelFinding;
  const evidence=chosen?.evidence||null;
  const mode=deterministic.verdict==='Contradicted'||deterministic.verdict==='Supported'?'merged':'ai';
  return {...deterministic,...(chosen||{}),verdict,evidence,mode};
}
export function buildEvaluationResult(cases) {
  const labels=['Supported','Contradicted','Not enough evidence'];
  const matrix=Object.fromEntries(labels.map((expected)=>[expected,Object.fromEntries(labels.map((actual)=>[actual,0]))]));
  for(const item of cases) matrix[item.expected][item.actual]+=1;
  const accuracy=Object.fromEntries(labels.map((label)=>{const total=Object.values(matrix[label]).reduce((sum,n)=>sum+n,0);return[label,total?matrix[label][label]/total:0];}));
  return {count:cases.length,accuracy,confusionMatrix:matrix};
}
