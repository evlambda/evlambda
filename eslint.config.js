// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import {defineConfig, globalIgnores} from 'eslint/config';
import {fixupPluginRules} from '@eslint/compat';
import babelParser from '@babel/eslint-parser';
import babelPlugin from '@babel/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores([
    'src/lezer/evlambda.js',
    'src/lezer/evlambda.terms.js'
  ]),
  {
    files: [
      '**/*.{js,jsx}'
    ],
    languageOptions: {
      parser: babelParser
    },
    plugins: {
      babel: babelPlugin,
      'react-hooks': fixupPluginRules(reactHooks)
    },
    rules: {
      'quotes': ['error', 'single'],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
]);
