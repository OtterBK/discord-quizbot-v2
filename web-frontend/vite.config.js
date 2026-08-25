import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// package.json이 "type": "module"이라 이 파일은 ESM으로 실행됨 - __dirname이 없어 import.meta.url로 계산.
const __dirname = dirname(fileURLToPath(import.meta.url));

// `npm run dev`로 로컬 개발 시 Express 백엔드(SYSTEM_CONFIG.WEB_SERVER_PORT, 기본 4321)로
// API 요청을 프록시한다. 빌드 산출물(dist/)은 web_express_app.ts가 같은 origin에서
// express.static으로 직접 서빙하므로 프로덕션에서는 프록시가 필요 없다.
//
// build.rollupOptions.input - 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1에서
// editor.html(퀴즈 편집기)이 추가되며 Vite 멀티페이지 빌드로 전환됨. 지정 안 하면 index.html만
// 빌드되어 editor.html은 dist/에 안 나옴 - 두 진입점 다 명시해야 함. presets.html(프리셋 관리,
// docs/plans/RANDOM_QUIZ_PRESET_PLAN.md 후속, 2026-08-20)도 동일한 이유로 세 번째 진입점 추가.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4321',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        presets: resolve(__dirname, 'presets.html'),
      },
    },
  },
});
