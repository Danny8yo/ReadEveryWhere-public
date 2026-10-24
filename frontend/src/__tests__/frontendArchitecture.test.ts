import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Resolve from this test, not cwd: moving the npm root must not silently skip checks.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const owned = ['views', 'features', 'shared'].flatMap(dir => files(join(root, dir)));
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler };
function imports(path: string) {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
}
function resolved(spec: string, path: string) {
  return ts.resolveModuleName(spec, path, options, ts.sys).resolvedModule?.resolvedFileName;
}
describe('前端依赖边界', () => {
  it('扫描所有业务 UI 和页面，不直接引用 API、缓存、传输或 Foliate', () => {
    const ui = owned.filter(path => path.endsWith('.vue') || /\/ui\/.*\.ts$/.test(path));
    expect(ui.length).toBeGreaterThan(20);
    expect(ui.some(path => path.endsWith('/reader/ui/BookReader.vue'))).toBe(true);
    const violations = ui.flatMap(path => imports(path).filter(spec => {
      const target = resolved(spec, path);
      return /\/api\/|\/foliate-js\//.test(spec) || !!target && /\/(apiClient|sseTransport|bookFileCache|bookFileTransfers)\.ts$/.test(target);
    }).map(spec => `${relative(root, path)} -> ${spec}`));
    expect(violations).toEqual([]);
  });
  it('核心的传递依赖不包含 Vue、Web 宿主或传输实现', () => {
    const entries = owned.filter(path => /\/(domain|model)\//.test(path) && path.endsWith('.ts'));
    expect(entries.length).toBeGreaterThan(20);
    const seen = new Set<string>(), violations: string[] = [];
    function visit(path: string) {
      if (seen.has(path)) return;
      seen.add(path);
      for (const spec of imports(path)) {
        const target = resolved(spec, path);
        if (spec === 'vue' || spec.endsWith('.vue') || /\/(api|web|ui|vendor)\//.test(spec)) {
          violations.push(`${relative(root, path)} -> ${spec}`);
        } else if (spec.startsWith('.') && target) visit(target);
      }
    }
    entries.forEach(visit);
    expect(violations).toEqual([]);
  });
  it('公共能力不能反向依赖具体业务', () => {
    const violations = files(join(root, 'shared')).filter(path => /\.(ts|vue)$/.test(path)).flatMap(path =>
      imports(path).filter(spec => {
        const target = resolved(spec, path);
        return !!target && target.startsWith(join(root, 'features') + '/');
      }).map(spec => `${relative(root, path)} -> ${spec}`));
    expect(violations).toEqual([]);
  });
});
