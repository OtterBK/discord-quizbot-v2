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
