/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    sourcemap: true
  },
  test: {
    // model/ 与 systems/ 是纯逻辑层，单测跑在 node 环境即可；
    // 一旦有测试需要触碰 ui/，这里必须换成 jsdom，并且说明原因。
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
