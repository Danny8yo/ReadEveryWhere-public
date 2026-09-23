import { DatabaseSync } from "node:sqlite";
import { searchPhrases } from "./position-index-file";
import { tokenizeKeywords } from "@readeverywhere/epub-core/keywords";
const phrase = (s:string,weight=1) => ({phrase:tokenizeKeywords(s).join(' '),weight});
describe('weighted positional retrieval',()=>{
  let db:DatabaseSync;
  beforeEach(()=>{
    db=new DatabaseSync(':memory:');db.exec('CREATE VIRTUAL TABLE fts USING fts5(tokens)');
    const docs=['临时表 磁盘','临时，时表 磁盘','临时表 缓存','锁I/O','锁 I O','哈哈','哈哈哈'];
    docs.forEach((s,i)=>db.prepare('INSERT INTO fts(rowid,tokens)VALUES(?,?)').run(i+1,tokenizeKeywords(s).join(' ')));
  });
  afterEach(()=>db.close());
  it('OR preserves complete phrases; AND is a query-time constraint on the same index',()=>{
    expect(searchPhrases(db,[phrase('临时表')]).map(r=>r.id).sort()).toEqual([1,3]);
    expect(searchPhrases(db,[phrase('临时表'),phrase('磁盘')]).map(r=>r.id).sort()).toEqual([1,2,3]);
    expect(searchPhrases(db,[phrase('临时表'),phrase('磁盘')],2).map(r=>r.id)).toEqual([1]);
    expect(searchPhrases(db,[phrase('锁I/O')]).map(r=>r.id)).toEqual([4]);
    expect(searchPhrases(db,[phrase('哈哈哈')]).map(r=>r.id)).toEqual([7]);
  });
  it('weights change score contributions without changing lexical eligibility',()=>{
    const a=searchPhrases(db,[phrase('缓存'),phrase('磁盘')]);
    const b=searchPhrases(db,[phrase('缓存',8),phrase('磁盘')]);
    expect(a.map(r=>r.id).sort()).toEqual(b.map(r=>r.id).sort());
    expect(b.find(r=>r.id===3)!.score).toBeCloseTo(a.find(r=>r.id===3)!.score*8,12);
    expect(b[0].id).toBe(3);
  });
  it('rejects unbounded plans, injection, repeated clauses and non-finite weights',()=>{
    for(const plan of [[],[phrase('锁',NaN)],[phrase('锁',0)],[phrase('锁',17)],[phrase('锁'),phrase('锁')],[{phrase:'" OR *',weight:1}]])
      expect(()=>searchPhrases(db,plan)).toThrow('QUERY_INVALID');
  });
});
