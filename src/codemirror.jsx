// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import React from 'react';

import {
  useRef,
  useEffect
} from 'react';

import {
  EditorState,
  StateField,
  StateEffect,
  Annotation,
  Transaction
} from '@codemirror/state';

import {
  EditorView,
  keymap,
  showPanel
} from '@codemirror/view';

import {
  history,
  defaultKeymap,
  historyKeymap,
  undo,
  redo,
  indentSelection
} from '@codemirror/commands';

import {
  searchKeymap
} from '@codemirror/search';

import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching
} from '@codemirror/language';

import {
  FileBuffer,
  ListenerBuffer
} from './ide.jsx';

import {
  evaluateFirstForm,
  formatForListener,
} from './evaluator.js';

import {
  copyInstance,
  copyMap
} from './utilities.js';

/*********************/
/* Clearable History */
/*********************/

const clearHistory = StateEffect.define();

function clearableHistory() {
  const historyExtension = history();
  const createF = historyExtension[0].createF;
  const updateF = historyExtension[0].updateF;
  historyExtension[0] = copyInstance(historyExtension[0], {
    updateF: (value, transaction) => {
      for (const effect of transaction.effects) {
        if (effect.is(clearHistory) && effect.value) {
          return createF(); // empty history
        }
      }
      return updateF(value, transaction);
    }
  });
  return historyExtension;
}

/*************/
/* Undo/Redo */
/*************/

function undoIfNotReadOnlyAll(arg) {
  if (!arg.state.field(stateReadOnlyAll)) {
    undo(arg);
  }
}

function redoIfNotReadOnlyAll(arg) {
  if (!arg.state.field(stateReadOnlyAll)) {
    redo(arg);
  }
}

/**************/
/* CodeMirror */
/**************/

// Change intiated in one of the views
//
//         /----------------\          /------------------\          /----------------\
//         | view state n   |          | buffer state n   |          | view state n   |
//         \----------------/          \------------------/          \----------------/
//
//    /------------------------\
//    |    /----------------\  |       /------------------\          /----------------\
// ---*--->| view state n+1 |  \--R--->| buffer state n+1 |          | view state n   |  updateViewAndBuffer
//         \----------------/          \------------------/          \----------------/
//
//         /----------------\          /------------------\          /----------------\
//   NOOP  | view state n+1 |<----R----| buffer state n+1 |----R---->| view state n+1 |  React re-render
//         \----------------/          \------------------/          \----------------/

// Change initiated in the buffer
//
//         /----------------\          /------------------\          /----------------\
//         | view state n   |          | buffer state n   |          | view state n   |
//         \----------------/          \------------------/          \----------------/
//
//         /----------------\          /------------------\          /----------------\  bufferCommand (undo, redo, ...)
//         | view state n   |      --->| buffer state n+1 |          | view state n   |  addToListener, clearListener
//         \----------------/          \------------------/          \----------------/  onRevertBufferSuccess
//
//         /----------------\          /------------------\          /----------------\
//         | view state n+1 |<----R----| buffer state n+1 |----R---->| view state n+1 |  React re-render
//         \----------------/          \------------------/          \----------------/

// R: rebaseTransaction

const stateVersion = StateField.define({
  create: () => null,
  update: (value, transaction) => {
    return versionChanged(transaction) ? value + 1 : value;
  }
});

function versionChanged(transaction) {
  if (transaction.docChanged) {
    return true;
  }
  for (const effect of transaction.effects) {
    if (effect.is(setStateReadOnlyAll) || effect.is(setStateReadOnlyEnd)) {
      return true;
    }
  }
  return false;
}

const setStateReadOnlyAll = StateEffect.define();
const stateReadOnlyAll = StateField.define({
  create: () => null,
  update: (value, transaction) => {
    const setReadOnlyAll = getEffectValue(transaction, setStateReadOnlyAll); // undefined or new value
    return setReadOnlyAll !== undefined ? setReadOnlyAll : value;
  }
});

const setStateReadOnlyEnd = StateEffect.define();
const stateReadOnlyEnd = StateField.define({
  create: () => null,
  update: (value, transaction) => {
    const setReadOnlyEnd = getEffectValue(transaction, setStateReadOnlyEnd); // undefined or new value
    return setReadOnlyEnd !== undefined ? setReadOnlyEnd : value;
  }
});

function getEffectValue(transaction, stateEffectType) {
  for (const effect of transaction.effects) {
    if (effect.is(stateEffectType)) {
      return effect.value;
    }
  }
  return undefined;
}

const stateWindowId = StateField.define({
  create: () => null,
  update: (value, transaction) => {
    return value;
  }
});

const originatingWindowId = Annotation.define();
let originatingWindowIdVar = undefined;

function stateDebugInfo(state) {
  const length = state.doc.length;
  const selectionFrom = state.selection.main.from;
  const selectionTo = state.selection.main.to;
  const version = state.field(stateVersion);
  const all = state.field(stateReadOnlyAll);
  const end = state.field(stateReadOnlyEnd);
  return `length=${length} from=${selectionFrom} to=${selectionTo} version=${version} all=${all} end=${end}`;
}

export function transactionDebugInfo(transaction) {
  const startState = transaction.startState;
  const state = transaction.state;
  const length = state.doc.length;
  const selectionFrom = state.selection.main.from;
  const selectionTo = state.selection.main.to;
  const startStateVersion = startState.field(stateVersion);
  const version = state.field(stateVersion);
  const all = state.field(stateReadOnlyAll);
  const end = state.field(stateReadOnlyEnd);
  return `length=${length} from=${selectionFrom} to=${selectionTo} versions=${startStateVersion}:${version} all=${all} end=${end}`;
}

function debugPanel () {
  return showPanel.of(view => {
    const dom = document.createElement('div');
    dom.textContent = stateDebugInfo(view.state);
    return {
      dom: dom,
      update: viewUpdate => dom.textContent = stateDebugInfo(viewUpdate.state)
    };
  })
}

export function CodeMirror({id, ide, window, buffer}) {
  const parentRef = useRef();
  const viewRef = useRef();
  useEffect(() => {
    //console.log('CREATE CodeMirror');
    viewRef.current = new EditorView({
      parent: parentRef.current,
      state: createViewState(id, ide, window, buffer),
      dispatch: (transaction, view) => updateViewAndBuffer(ide, buffer, transaction, view)
    });
    viewRef.current.dispatch({scrollIntoView: true});
    updateWindowView(ide, window, viewRef.current);
    return () => {
      //console.log('DESTROY CodeMirror');
      updateWindowAnchors(ide, window, buffer, viewRef.current);
      viewRef.current.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const view = viewRef.current;
    const state = view.state;
    const transaction = buffer.transaction; // version n to version n+1
    if (state.field(stateVersion) === transaction.startState.field(stateVersion)) {
      // update the view state from version n to version n+1
      //console.log('view.state = buffer.tr.startState');
      view.update([rebaseTransaction(transaction, state)]);
    } else if (state.field(stateVersion) === transaction.state.field(stateVersion)) {
      // the view state is already up to date
      //console.log('view.state = buffer.tr.state');
    } else {
      // should not happen
      console.log('CodeMirror version mismatch 1: '
                + 'view.state = ' + state.field(stateVersion) + ' '
                + 'buffer.tr.startState = ' + transaction.startState.field(stateVersion) + ' '
                + 'buffer.tr.state = ' + transaction.state.field(stateVersion));
      view.setState(createViewState(id, ide, window, buffer));
    }
  }, [buffer]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cm-outer-container">
      <div className="cm-inner-container" ref={parentRef}></div>
    </div>
  );
}

function updateWindowView(staleIde, staleWindow, view) {
  staleIde.setWindows(windows => {
    const window = windows.get(staleWindow.id);
    const newWindows = new Map(windows);
    newWindows.set(window.id, copyInstance(window, {
      view: view
    }));
    return newWindows;
  });
}

function updateWindowAnchors(staleIde, staleWindow, staleBuffer, view) {
  staleIde.setWindows(windows => {
    const window = windows.get(staleWindow.id);
    const newWindows = new Map(windows);
    newWindows.set(window.id, copyInstance(window, {
      anchors: copyMap(window.anchors, staleBuffer.id, view.state.selection.main.anchor)
    }));
    return newWindows;
  });
}

export function createBufferTransaction(contents, readOnlyAll = false, readOnlyEnd = 0) {
  const extensions = [
    clearableHistory(),
    stateVersion,
    stateVersion.init(() => 0),
    stateReadOnlyAll,
    stateReadOnlyAll.init(() => readOnlyAll),
    stateReadOnlyEnd,
    stateReadOnlyEnd.init(() => readOnlyEnd),
    EditorState.transactionExtender.of(transaction => ({annotations: originatingWindowId.of(originatingWindowIdVar)}))
  ];
  const changes = {from: 0, insert: contents};
  const annotations = [Transaction.addToHistory.of(false)];
  return EditorState.create({doc: '', extensions: extensions}).update({changes: changes, annotations: annotations});
}

function createViewState(id, ide, window, buffer) {
  const bufferState = buffer.transaction.state;
  const extensions = [
    EditorView.contentAttributes.of({
      id: id
    }),
    EditorView.theme({
      '&': {
        width: '100%',
        height: '100%',
        fontSize: '14pt'
      }
    }),
    EditorView.lineWrapping,
    keymap.of([
      ...defaultKeymap,
      {
        linux: 'Ctrl-z',
        win: 'Ctrl-z',
        mac: 'Cmd-z',
        run: () => bufferCommand(ide, window, buffer, undoIfNotReadOnlyAll),
        preventDefault: true
      },
      {
        linux: 'Ctrl-y',
        win: 'Ctrl-y',
        mac: 'Cmd-Shift-z',
        run: () => bufferCommand(ide, window, buffer, redoIfNotReadOnlyAll),
        preventDefault: true
      },
      {
        linux: 'Ctrl-Shift-z',
        run: () => bufferCommand(ide, window, buffer, redoIfNotReadOnlyAll),
        preventDefault: true
      },
      {
        key: 'Tab',
        run: indentSelection
      },
      ...searchKeymap
    ]),
    buffer.language(),
    syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
    bracketMatching(),
    stateVersion,
    stateVersion.init(() => bufferState.field(stateVersion)),
    stateReadOnlyAll,
    stateReadOnlyAll.init(() => bufferState.field(stateReadOnlyAll)),
    stateReadOnlyEnd,
    stateReadOnlyEnd.init(() => bufferState.field(stateReadOnlyEnd)),
    stateWindowId,
    stateWindowId.init(() => window.id),
    //debugPanel()
  ];
  if (buffer instanceof FileBuffer) {
    const anchor = Math.min(window.anchors.get(buffer.id) || 0, bufferState.doc.length);
    return EditorState.create({doc: bufferState.doc, selection: {anchor: anchor}, extensions: extensions});
  } else if (buffer instanceof ListenerBuffer) {
    extensions.unshift(keymap.of([
      {key: 'Enter', run: view => listenerEnter(ide, window, buffer, view)}
    ]));
    const anchor = Math.min(window.anchors.get(buffer.id) || bufferState.doc.length, bufferState.doc.length);
    return EditorState.create({doc: bufferState.doc, selection: {anchor: anchor}, extensions: extensions});
  }
}

function updateViewAndBuffer(staleIde, staleBuffer, transaction, view) {
  const state = view.state;
  const readOnlyAll = state.field(stateReadOnlyAll);
  const readOnlyEnd = state.field(stateReadOnlyEnd);
  let discardTransaction = readOnlyAll;
  transaction.changes.iterChangedRanges((from, to) => discardTransaction = discardTransaction || from < readOnlyEnd);
  if (!discardTransaction) {
    view.update([transaction]);
    if (versionChanged(transaction)) {
      staleIde.setBuffers(buffers => {
        const buffer = buffers.get(staleBuffer.id);
        if (buffer.transaction.state.field(stateVersion) === transaction.startState.field(stateVersion)) {
          const newBuffers = new Map(buffers);
          const rebasedTransaction = rebaseTransaction(transaction, buffer.transaction.state);
          newBuffers.set(buffer.id, copyInstance(buffer, {
            transaction: rebasedTransaction,
            modified: !rebasedTransaction.state.doc.eq(buffer.lastSavedContents)
          }));
          return newBuffers;
        } else {
          // should not happen
          console.log('CodeMirror version mismatch 2: '
                    + 'buffer.tr.state = ' + buffer.transaction.state.field(stateVersion) + ' '
                    + 'tr.startState = ' + transaction.startState.field(stateVersion));
          return buffers;
        }
      });
    }
  }
}

function rebaseTransaction(transaction, state) {
  const rebasingToOriginatingWindow = transaction.annotation(originatingWindowId) === state.field(stateWindowId, false);
  const changes = transaction.changes;
  const effects = transaction.effects.filter(effect => effect.is(setStateReadOnlyAll) || effect.is(setStateReadOnlyEnd));
  let selection = undefined;
  let scrollIntoView = false;
  switch (transaction.annotation(Transaction.userEvent)) {
    case 'undo':
    case 'redo':
      if (rebasingToOriginatingWindow) {
        let changeFrom = null;
        let changeTo = null;
        transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {changeFrom = fromB; changeTo = toB;});
        if (changeFrom !== null && changeTo !== null) {
          selection = {anchor: changeFrom, head: changeTo};
          scrollIntoView = true;
        }
      }
      break;
    case 'foundNoForm':
      if (rebasingToOriginatingWindow) {
        selection = {anchor: transaction.state.doc.length};
        scrollIntoView = true;
      }
      break;
    case 'addToListener':
    case 'clearListener':
      selection = {anchor: transaction.state.doc.length};
      scrollIntoView = true;
      break;
    default:
      break;
  }
  return state.update({changes: changes, effects: effects, selection: selection, scrollIntoView: scrollIntoView});
}

function bufferCommand(staleIde, staleWindow, staleBuffer, fn) {
  staleIde.setBuffers(buffers => {
    const buffer = buffers.get(staleBuffer.id);
    const newBuffers = new Map(buffers);
    const dispatch = transaction =>
      newBuffers.set(buffer.id, copyInstance(buffer, {
        transaction: transaction,
        modified: !transaction.state.doc.eq(buffer.lastSavedContents)
      }));
    originatingWindowIdVar = staleWindow.id;
    fn({state: buffer.transaction.state, dispatch: dispatch});
    originatingWindowIdVar = undefined;
    return newBuffers;
  });
  return true;
}

function listenerEnter(staleIde, staleWindow, staleBuffer, view) {
  const state = view.state;
  const docLength = state.doc.length;
  if (!state.field(stateReadOnlyAll) && state.selection.main.from === docLength && state.selection.main.to === docLength) {
    const text = state.sliceDoc(state.field(stateReadOnlyEnd));
    evaluateFirstForm(text, response => addToListener(staleIde, staleWindow, staleBuffer, formatForListener(response)));
    view.dispatch({effects: [setStateReadOnlyAll.of(true)]});
    return true;
  } else {
    return false;
  }
}

function addToListener(staleIde, staleWindow, staleBuffer, text) {
  staleIde.setBuffers(buffers => {
    const buffer = buffers.get(staleBuffer.id);
    const newBuffers = new Map(buffers);
    const state = buffer.transaction.state;
    const docLength = state.doc.length;
    const transactionSpec = {};
    if (text === null) { // FOUND_NO_FORM
      transactionSpec.changes = {from: docLength, insert: '\n'};
      transactionSpec.effects = [
        setStateReadOnlyAll.of(false)
      ];
      transactionSpec.userEvent = 'foundNoForm';
    } else {
      transactionSpec.changes = {from: docLength, insert: '\n' + text + '\n> '};
      transactionSpec.effects = [
        setStateReadOnlyAll.of(false),
        setStateReadOnlyEnd.of(docLength + text.length + 4),
        clearHistory.of(true)
      ];
      transactionSpec.userEvent = 'addToListener';
    }
    originatingWindowIdVar = staleWindow.id;
    const transaction = state.update(transactionSpec);
    originatingWindowIdVar = undefined;
    newBuffers.set(buffer.id, copyInstance(buffer, {
      transaction: transaction,
      modified: !transaction.state.doc.eq(buffer.lastSavedContents)
    }));
    return newBuffers;
  });
}

export function clearListener(staleIde, staleBuffer) {
  staleIde.setBuffers(buffers => {
    const buffer = buffers.get(staleBuffer.id);
    const newBuffers = new Map(buffers);
    const state = buffer.transaction.state;
    const readOnlyEnd = state.field(stateReadOnlyEnd);
    const transactionSpec = {};
    transactionSpec.changes = {from: 0, to: readOnlyEnd, insert: '> '};
    transactionSpec.effects = [
      setStateReadOnlyEnd.of(2),
      clearHistory.of(true)
    ];
    transactionSpec.userEvent = 'clearListener';
    const transaction = state.update(transactionSpec);
    newBuffers.set(buffer.id, copyInstance(buffer, {
      transaction: transaction,
      modified: !transaction.state.doc.eq(buffer.lastSavedContents)
    }));
    return newBuffers;
  });
}

/**************/
/* Minibuffer */
/**************/

const minibufferExtensions = [
  EditorView.theme({
    '&': {
      fontSize: '12pt'
    },
    '.cm-scroller': {
      overflow: 'hidden'
    }
  }),
  history(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap
  ]),
  EditorState.transactionFilter.of(transaction => transaction.state.doc.lines > 1 ? [] : [transaction]),
  EditorView.editable.of(false)
];

export function Minibuffer({message}) {
  const parentRef = useRef();
  const viewRef = useRef();
  useEffect(() => {
    viewRef.current = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({doc: '', extensions: minibufferExtensions})
    });
    return () => {
      viewRef.current.destroy();
    };
  }, []);
  useEffect(() => {
    viewRef.current.setState(EditorState.create({doc: message, extensions: minibufferExtensions}));
  }, [message]);
  return (
    <div ref={parentRef}></div>
  );
}
