// 封面流视觉重构：逐像素比较两组截图（docs/封面流视觉重构计划.md 第 3.2 节）。
// 用法：node scripts/visual-diff.mjs visual-shots/p0-baseline visual-shots/p2
// 对第二个目录里的每张 PNG，找第一个目录里的同名文件比较；RGB 差值合计超过 24 的像素算不同。
// 用于确认“本阶段没动的页面确实没变”；有意改动的页面要人工对照设计稿看。
import { chromium } from 'playwright';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("用法：node scripts/visual-diff.mjs <基线目录> <对比目录>"); process.exit(2); }
const browser = await chromium.launch(); const page = await browser.newPage();
for (const name of readdirSync(b).filter(f => f.endsWith('.png')).sort()) {
  if (!existsSync(`${a}/${name}`)) { console.log(name.padEnd(34), 'missing in baseline'); continue; }
  const r = await page.evaluate(async ([x, y]) => {
    const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const [p, q] = await Promise.all([load(x), load(y)]);
    if (p.width !== q.width || p.height !== q.height) return `size ${p.width}x${p.height} vs ${q.width}x${q.height}`;
    const c = document.createElement('canvas'); c.width = p.width; c.height = p.height; const g = c.getContext('2d');
    g.drawImage(p, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(q, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, minY = 1e9, maxY = -1; for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i]-d2[i]) + Math.abs(d1[i+1]-d2[i+1]) + Math.abs(d1[i+2]-d2[i+2]) > 24) { n++; const y = Math.floor(i / 4 / c.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return n ? `${n} px differ (${(100*n/(c.width*c.height)).toFixed(2)}%), rows ${minY}-${maxY}` : 'identical';
  }, ['data:image/png;base64,' + readFileSync(`${a}/${name}`).toString('base64'), 'data:image/png;base64,' + readFileSync(`${b}/${name}`).toString('base64')]);
  console.log(name.padEnd(34), r);
}
await browser.close();
