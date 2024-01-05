// SPDX-FileCopyrightText: Copyright (c) 2024 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import {
  LanguageKeyword
} from './evlambda.terms.js';

const syntacticKeywords = [
  'quote',
  'progn',
  'if',
  '_vlambda',
  '_mlambda',
  '_flambda',
  '_dlambda',
  'vref',
  'vset!',
  'fref',
  'fset!',
  'dref',
  'dset!',
  '_for-each',
  '_catch-errors',
  'apply',
  'multiple-value-call',
  'multiple-value-apply'
];

const macros = [
  'quasiquote',
  'unquote',
  'unquote-splicing',
  'cond',
  'econd',
  'vlambda',
  'mlambda',
  'flambda',
  'dlambda',
  'vdef',
  'fdef',
  'mdef',
  'vlet',
  'flet',
  'mlet',
  'dlet',
  'vlet*',
  'flet*',
  'dlet*',
  'fletrec'
];

const languageKeywords = new Map();

for (const syntacticKeyword of syntacticKeywords) {
  languageKeywords.set(syntacticKeyword, true);
}

for (const macro of macros) {
  languageKeywords.set(macro, true);
}

export function specializeSymbol(symbol) {
  return languageKeywords.has(symbol) ? LanguageKeyword : -1;
}
