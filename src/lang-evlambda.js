// SPDX-FileCopyrightText: Copyright (c) 2024 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import {
  parser
} from './lezer/evlambda.js';

import {
  styleTags,
  tags
} from '@lezer/highlight';

import {
  indentNodeProp,
  LRLanguage,
  LanguageSupport,
  syntaxTree
} from '@codemirror/language';

const parserWithMetadata = parser.configure({
  props: [
    styleTags({
      Void: tags.null,
      Boolean: tags.bool,
      Number: tags.number,
      Character: tags.character,
      String: tags.string,
      Symbol: tags.name,
      LanguageKeyword: tags.keyword,
      'Quote Quasiquote Unquote UnquoteSplicing HashPlus HashMinus': tags.punctuation,
      'OpeningParenthesis ClosingParenthesis HashOpeningParenthesis': tags.paren,
      'XMLMixedElementStartTag XMLPureElementStartTag': tags.tagName,
      'XMLMixedElementEndTag XMLPureElementEndTag': tags.tagName,
      'XMLEmptyElementTag': tags.tagName,
      'XMLComment': tags.comment
    }),
    indentNodeProp.add({
      List: indentList,
      XMLPureElement: context => {
        // <ul>
        //   <li></li>
        //   <li></li>
        //   <li></li>
        // </ul>
        const indentingXMLPureElementEndTag = /^\s*<\//.test(context.textAfter);
        return context.column(context.node.from) + (indentingXMLPureElementEndTag ? 0 : context.unit);
      }
    })
  ]
});

const specialIndentations = new Map([
  // [<number-of-special-operands>, <indentation-of-special-operands>, <indentation-of-ordinary-operands>]
  ['progn', [0, 0, 2]],
  ['if', [2, 4, 2]],
  ['_vlambda', [1, 4, 2]],
  ['_mlambda', [1, 4, 2]],
  ['_flambda', [1, 4, 2]],
  ['_dlambda', [1, 4, 2]],
  ['vlambda', [1, 4, 2]],
  ['mlambda', [1, 4, 2]],
  ['flambda', [1, 4, 2]],
  ['dlambda', [1, 4, 2]],
  ['vdef', [1, 4, 2]],
  ['fdef', [2, 4, 2]],
  ['mdef', [2, 4, 2]],
  ['vlet', [1, 4, 2]],
  ['flet', [1, 4, 2]],
  ['mlet', [1, 4, 2]],
  ['dlet', [1, 4, 2]],
  ['vlet*', [1, 4, 2]],
  ['flet*', [1, 4, 2]],
  ['dlet*', [1, 4, 2]],
  ['fletrec', [1, 4, 2]]
]);

const localFunctionDefiners = ['flet', 'mlet', 'flet*', 'fletrec'];

function isLocalFunctionDefinition(context) {
  // (<flet|mlet|flet*|fletrec> (... (<variable> <parameter-list> <form>*) ...) <form>*)
  //                                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  const node = context.node.parent?.parent?.parent?.parent?.firstChild?.nextSibling?.firstChild;
  if (node && localFunctionDefiners.includes(context.state.sliceDoc(node.from, node.to))) {
    // redo the check more thoroughly
    // (<variable> <parameter-list> <form>*)
    let up; // EVLObject
    let upp; // List: (... (<variable> <parameter-list> <form>*) ...)
    let uppp; // EVLObject
    let upppp; // List: (<flet|mlet|flet*|fletrec> (... (<variable> <parameter-list> <form>*) ...) <form>*)
    let child1; // OpeningParenthesis
    let child2; // EVLObject
    let child22; // LanguageKeyword: <flet|mlet|flet*|fletrec>
    let child3; // EVLObbject
    let child33; // List: (... (<variable> <parameter-list> <form>*) ...)
    if ((up = context.node.parent) && (upp = up.parent) && (uppp = upp.parent) && (upppp = uppp.parent)) {
      if (up.name === 'EVLObject' && upp.name === 'List' && uppp.name === 'EVLObject' && upppp.name === 'List') {
        if ((child1 = upppp.firstChild) && (child2 = child1.nextSibling) && (child3 = child2.nextSibling)) {
          if (child1.name === 'OpeningParenthesis' && child2.name === 'EVLObject' && child3.name === 'EVLObject') {
            if ((child22 = child2.firstChild) && (child33 = child3.firstChild)) {
              if (child22.name === 'LanguageKeyword' && child33.name === 'List') {
                if (localFunctionDefiners.includes(context.state.sliceDoc(child22.from, child22.to))) {
                  if (child33.from === upp.from && child33.to === upp.to) {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

// (list
//  1
//  2
//  3
//  )

// (list 1
//       2
//       3
//       )

// (fletrec
//     ((foo
//          (x)
//        x)
//      (bar
//          (x)
//        x))
//   x
//   )

function indentList(context) {
  const defaultIndentation = context.column(context.node.from) + 1;
  let child = context.node.firstChild;
  let n = 0;
  let operatorTo = null;
  let firstOperandFrom = null;
  let specialIndentation = undefined;
  if (isLocalFunctionDefinition(context)) {
    specialIndentation = [1, 4, 2];
  }
  while (child !== null) {
    switch (n) {
      case 0: // opening parenthesis
        break;
      case 1: // operator
        operatorTo = child.to;
        if (specialIndentation === undefined && child.name === 'EVLObject') {
          const node = child.firstChild;
          if (node !== null && (node.name === 'Symbol' || node.name === 'LanguageKeyword')) {
            specialIndentation = specialIndentations.get(context.state.sliceDoc(node.from, node.to));
          }
        }
        break;
      case 2: // first operand
        firstOperandFrom = child.from;
        break;
      default:
        break;
    }
    if (child.from >= context.pos) { // first child after pos
      if (specialIndentation !== undefined) {
        const [nspecials, special, ordinary] = specialIndentation;
        switch (n) {
          case 0: // opening parenthesis
            return null;
          case 1: // operator
            return defaultIndentation;
          default:
            return context.column(context.node.from) + (n - 1 <= nspecials ? special : ordinary);
        }
      } else {
        switch (n) {
          case 0: // opening parenthesis
            return null;
          case 1: // operator
            return defaultIndentation;
          case 2: // first operand
            return defaultIndentation;
          default:
            if (context.state.sliceDoc(operatorTo, firstOperandFrom).includes('\n')) {
              return defaultIndentation;
            } else {
              return context.column(context.node.from) + firstOperandFrom - context.node.from;
            }
        }
      }
    }
    child = child.nextSibling;
    n++;
  }
}

const evlambdaLanguage = LRLanguage.define({
  parser: parserWithMetadata,
  languageData: {
    wordChars: '!$%&*+-./:;<=>?@\\^_|~' // "#'(),[]`{}
  }
});

export function evlambda() {
  return new LanguageSupport(evlambdaLanguage);
}

function findTopEVLObject(tree, position, side) {
  let node = tree.resolve(position, side);
  let topEVLObject = null;
  while (node !== null) {
    if (node.name === 'EVLObject') {
      topEVLObject = node;
    }
    node = node.parent;
  }
  return topEVLObject;
}

export function findForm(state, position) {
  const tree = syntaxTree(state);
  const formCoveringPosition = findTopEVLObject(tree, position, 0);
  if (formCoveringPosition !== null) {
    return formCoveringPosition;
  }
  const formDirectlyAfterPosition = findTopEVLObject(tree, position, 1);
  if (formDirectlyAfterPosition !== null) {
    return formDirectlyAfterPosition;
  }
  while (position > 0 && ' \n'.includes(state.sliceDoc(position - 1, position))) {
    position--;
  }
  const formBeforePosition = findTopEVLObject(tree, position, -1);
  if (formBeforePosition !== null) {
    return formBeforePosition;
  }
  return null;
}
