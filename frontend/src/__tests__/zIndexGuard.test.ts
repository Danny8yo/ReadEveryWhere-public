// 层级守卫（docs/封面流视觉重构计划.md 第 5 节）：页面和业务 UI 不允许新增裸 z-index 数字，
// 只能用 styles.css 里的 --ui-z-* 变量（Tailwind 写成 z-(--ui-z-modal)）。
// 现有违规按文件登记在 LEGACY 里，只许减少不许增加；某个文件改完后把它从 LEGACY 删掉。
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_Z = /\bz-\[-?\d+\]|(?<![\w-])-?z-\d+\b|z-index\s*:\s*-?\d+/g;

/** 重构开始前（2026-10-11）已有的裸 z-index 数量；P8 后已全部清零，不要再往里加 */
const LEGACY: Record<string, number> = {};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
function uiFiles(): string[] {
  const dirs = ['views', 'shared/ui', ...readdirSync(join(root, 'features')).map(name => `features/${name}/ui`)]
    .map(dir => join(root, dir)).filter(existsSync);
  return [join(root, 'App.vue'), ...dirs.flatMap(walk)].filter(path => /\.(vue|css|ts)$/.test(path));
}

describe('层级守卫', () => {
  it('不新增裸 z-index 数字', () => {
    const problems = uiFiles().flatMap(path => {
      const file = relative(root, path);
      const count = (readFileSync(path, 'utf8').match(RAW_Z) ?? []).length;
      const allowed = LEGACY[file] ?? 0;
      return count > allowed ? [`${file}: ${count} 处（允许 ${allowed}），请改用 --ui-z-* 变量`] : [];
    });
    expect(problems).toEqual([]);
  });
  it('登记表里的文件都还存在', () => {
    expect(Object.keys(LEGACY).filter(file => !existsSync(join(root, file)))).toEqual([]);
  });
});
