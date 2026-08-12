'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'custom_node_modules/**',
      'log/**',
      'quizdata/**',
      'cache/**',
      'bgm_bak/**',
      'notes/**',
      'dist/**',
      'web-frontend/**', //React+Vite 독립 프로젝트(퀴즈 선택 웹 연동) - ESM/JSX/브라우저 환경이라 이 CommonJS 전용 설정 대상이 아님. 자체 lint 설정 없이 vite build의 esbuild 진단으로 충분(WEB_INTEGRATION_PLAN.md 참고)
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-control-regex': 'warn',
      'no-async-promise-executor': 'warn',
      'no-prototype-builtins': 'warn',
      'no-empty-pattern': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  prettierConfig,
];
