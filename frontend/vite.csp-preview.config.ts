import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// CSP 回归专用的 preview：与生产 Caddy 一样同源托管 dist 并反代 /api，
// CSP 直接取自 deploy/caddy/Caddyfile，避免测试与线上策略分叉。
const caddyfile = readFileSync(fileURLToPath(new URL('../deploy/caddy/Caddyfile', import.meta.url)), 'utf8');
const csp = caddyfile.match(/^\s*Content-Security-Policy\s+"([^"]+)"/m)?.[1];
if (!csp) throw new Error('deploy/caddy/Caddyfile 中未找到 Content-Security-Policy');

const backend = process.env.E2E_CSP_BACKEND_ORIGIN ?? 'http://localhost:3124';

export default defineConfig({
  preview: {
    headers: process.env.E2E_CSP_DISABLED === '1' ? {} : { 'Content-Security-Policy': csp },
    proxy: { '/api': { target: backend, changeOrigin: false } },
  },
});
