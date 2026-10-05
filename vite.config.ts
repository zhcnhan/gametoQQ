/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    /*
     * ★ `sourcemap: false`（2026-10 改的，原来是 `true`）。
     *
     * 它同时解决两件事，两件都与"发给朋友试玩"有关：
     *
     *  ① **体积**：打开时产出的是 `dist/assets/index-*.js.map`，
     *     2.1 MB —— 比它对应的那份 JS（557 KB / gzip 240 KB）还大四倍。
     *     手机上打开一次就要把它也拉下来；
     *  ② **源码**：整份 `.ts` 源码都在那个文件里，任何人 F12 都读得到。
     *     自己调试时这很方便，但**发布的那一份不该带**。
     *
     * 要调试线上问题时的正确做法是**临时**开一次（`--sourcemap` 或改回 `true`），
     * 而不是把它长期留在配置里。dev 模式（`npm run dev`）不受这一条影响，
     * 那一份本来就是源码。
     */
    sourcemap: false
  },
  test: {
    // model/ 与 systems/ 是纯逻辑层，单测跑在 node 环境即可；
    // 一旦有测试需要触碰 ui/，这里必须换成 jsdom，并且说明原因。
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
