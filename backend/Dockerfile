# syntax=docker/dockerfile:1
# Generic local build example. Build with: docker build -f backend/Dockerfile .
# Node 补丁版本与仓库根 .nvmrc 保持一致；本项目依赖内置 node:sqlite，不可降到 Node 22。
FROM node:24.22.1-alpine
WORKDIR /workspace
RUN apk add --no-cache qpdf
COPY packages/epub-core/ packages/epub-core/
COPY backend/myapp/package.json backend/myapp/package-lock.json backend/myapp/
RUN cd packages/epub-core && npm ci --omit=dev
RUN cd backend/myapp && npm ci
COPY backend/myapp/ backend/myapp/
RUN cd backend/myapp && npm run build
WORKDIR /workspace/backend/myapp
CMD ["node", "dist/main.js"]
