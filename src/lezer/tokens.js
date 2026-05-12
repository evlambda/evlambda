// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import {
  LanguageKeyword
} from './evlambda.terms.js';

const specialOperators = [
  'quote',
  'progn',
  'if',
  '_for-each',
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
  'block',
  'return-from',
  'catch',
  'throw',
  '_handler-bind',
  'unwind-protect',
  'apply',
  'multiple-value-call',
  'multiple-value-apply'
];

const macros = [
  'when',
  'cond',
  'econd',
  'loop',
  'vlambda',
  'mlambda',
  'flambda',
  'dlambda',
  'destructuring-bind',
  'multiple-value-bind',
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
  'fletrec',
  'ignore-errors'
];

const languageKeywords = new Map();

for (const specialOperator of specialOperators) {
  languageKeywords.set(specialOperator, true);
}

for (const macro of macros) {
  languageKeywords.set(macro, true);
}

export function specializeSymbol(symbol) {
  return languageKeywords.has(symbol) ? LanguageKeyword : -1;
}
