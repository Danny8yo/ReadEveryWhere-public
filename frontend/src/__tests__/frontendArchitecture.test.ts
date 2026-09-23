import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import ts from 'typescript';
const root=process.cwd();
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]);}
describe('前端依赖边界',()=>{
 it('页面和组件不直接引用具体 API、缓存或 Foliate',()=>{
  const violations=files(join(root,'views')).concat(files(join(root,'components'))).filter(path=>path.endsWith('.vue')).flatMap(path=>{
   const source=readFileSync(path,'utf8');return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].filter(match=>/\/api\/|\/services\/|\/foliate-js\//.test(match[1])).map(match=>`${relative(root,path)} -> ${match[1]}`);
  });expect(violations).toEqual([]);
 });
 it('核心的传递依赖不包含 Vue、Web 宿主或传输实现',()=>{
  const entries=files(join(root,'features')).filter(path=>/\/(domain|model)\//.test(path)&&path.endsWith('.ts')).concat(files(join(root,'shared/domain')),files(join(root,'shared/model')));
  const seen=new Set<string>(),violations:string[]=[];
  function visit(path:string){if(seen.has(path))return;seen.add(path);const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
   for(const node of ast.statements){if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier))continue;const spec=node.moduleSpecifier.text;
    if(spec==='vue'||spec.endsWith('.vue')||/\/api\/|\/web\/|\/services\/|\/foliate-js\//.test(spec)){violations.push(`${relative(root,path)} -> ${spec}`);continue;}
    if(spec.startsWith('.')){const resolved=ts.resolveModuleName(spec,path,{moduleResolution:ts.ModuleResolutionKind.Bundler},ts.sys).resolvedModule;if(resolved)visit(resolved.resolvedFileName);}
   }
  }entries.forEach(visit);expect(violations).toEqual([]);
 });
});
