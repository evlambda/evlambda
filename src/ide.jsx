// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import React from 'react';

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect
} from 'react';

import {
  createRoot
} from 'react-dom/client';

import {
  UAParser
} from 'ua-parser-js';

import JSZip from 'jszip';

import {
  TextButton,
  FilledButton,
  MenubarRoot,
  MenubarMenu,
  MenubarItem,
  MenubarDialog,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarRightSlot,
  MenubarSeparator,
  InfobarRoot,
  InfobarItem,
  TilingWindow,
  FillingWindow,
  WindowToolbar,
  WindowContentsArea,
  WindowStatusbar,
  ToolbarRoot,
  ToolbarButton,
  ContentsAreaRoot,
  StatusbarRoot,
  DialogButtons,
  DialogButton,
  DialogDefaultButton,
  Blank,
  IFrame
} from './components.jsx';

import {
  CodeMirror,
  Minibuffer,
  createBufferTransaction,
  transactionDebugInfo,
  clearListener
} from './codemirror.jsx';

import {
  css
} from '@codemirror/lang-css';

import {
  evlambda,
  findForm
} from './lang-evlambda.js';

import {
  html
} from '@codemirror/lang-html';

import {
  javascript
} from '@codemirror/lang-javascript';

import {
  xml
} from '@codemirror/lang-xml';

import {
  unifiedPathnamePathname,
  getFileSystemCapabilities,
  getFileContents,
  putFileContents
} from './ufs.js';

import {
  evaluatorNames,
  createEvaluator,
  evaluateFirstForm,
  evaluateAllForms,
  convertEVLToHTML,
  formatForMinibuffer,
  abortEvaluation
} from './evaluator.js';

import {
  copyInstance
} from './utilities.js';

/*********************/
/* Browser Detection */
/*********************/

const {os} = UAParser();

/**********/
/* Buffer */
/**********/

class Buffer {
  static #id = 0;
  constructor(contents, readOnlyAll, readOnlyEnd) {
    this.id = Buffer.#id++;
    this.transaction = createBufferTransaction(contents, readOnlyAll, readOnlyEnd);
    this.lastSavedContents = this.transaction.state.doc;
    this.modified = false;
  }
  contentsArea(ide, window) {
    const id = contentsAreaId(window.id);
    switch (window.displayMode) {
      case DISPLAY_RAW:
        return <CodeMirror id={id}
                           ide={ide}
                           window={window}
                           buffer={this}/>;
      case DISPLAY_PENDING:
        return <Blank id={id}/>;
      case DISPLAY_HTML:
        return <IFrame id={id}
                       src={window.htmlURL}/>;
    }
  }
}

function contentsAreaId(windowId) {
  return 'contents_area_' + windowId;
}

export class FileBuffer extends Buffer {
  constructor(unifiedPathname, contents) {
    super(contents, undefined, undefined);
    this.unifiedPathname = unifiedPathname;
  }
  static create(buffers, unifiedPathname, contents) {
    let buffer = null;
    if (/\/[A-Z-]+$/.test(unifiedPathname)) {
      buffer = new AllCapsBuffer(unifiedPathname, contents);
    } else {
      const index = unifiedPathname.lastIndexOf('.');
      if (index !== -1) {
        const extension  = unifiedPathname.substring(index + 1);
        switch (extension) {
          case 'css':
            buffer = new CSSBuffer(unifiedPathname, contents);
            break;
          case 'evl':
            buffer = new EVLBuffer(unifiedPathname, contents);
            break;
          case 'js':
            buffer = new JSBuffer(unifiedPathname, contents);
            break;
          case 'xslt':
            buffer = new XSLTBuffer(unifiedPathname, contents);
            break;
        }
      }
    }
    if (buffer === null) {
      throw new Error('Unknown file type.');
    }
    buffers.set(buffer.id, buffer);
    return buffer;
  }
  toolbar(ide, window) {
    //return <FakeWindowToolbar ide={ide} window={window}/>;
    return null;
  }
  bufferMenuEntry() {
    return this.unifiedPathname + (this.modified ? '*' : '');
  }
  statusMessage() {
    //return `${this.unifiedPathname + (this.modified ? '*' : '')} [${transactionDebugInfo(this.transaction)}]`;
    return `${this.unifiedPathname + (this.modified ? '*' : '')}`;
  }
}

class AllCapsBuffer extends FileBuffer {
  language() {
    return html();
  }
  toggleOnHTMLMode(ide, window) {
    const css = findFileBuffer(ide.buffers, '/system/all-caps.css').transaction.state.sliceDoc();
    const cssBlob = new Blob([css], {type: 'text/css'});
    const cssURL = URL.createObjectURL(cssBlob);
    const js = findFileBuffer(ide.buffers, '/system/all-caps.js').transaction.state.sliceDoc();
    const jsBlob = new Blob([js], {type: 'text/javascript'});
    const jsURL = URL.createObjectURL(jsBlob);
    const state = this.transaction.state;
    const text = state.sliceDoc();
    let html = text;
    html = html.replaceAll('___cssURL___', cssURL);
    html = html.replaceAll('___jsURL___', jsURL);
    html = html.replaceAll('___windowId___', window.id);
    setTimeout(() => toggleHTMLModeCommand2(ide, window, html, cssURL, jsURL));
  }
}

class CSSBuffer extends FileBuffer {
  language() {
    return css();
  }
}

class EVLBuffer extends FileBuffer {
  language() {
    return evlambda();
  }
  toggleOnHTMLMode(ide, window) {
    const xslt = findFileBuffer(ide.buffers, '/system/evl2html.xslt').transaction.state.sliceDoc();
    const css = findFileBuffer(ide.buffers, '/system/evl2html.css').transaction.state.sliceDoc();
    const cssBlob = new Blob([css], {type: 'text/css'});
    const cssURL = URL.createObjectURL(cssBlob);
    const js = findFileBuffer(ide.buffers, '/system/evl2html.js').transaction.state.sliceDoc();
    const jsBlob = new Blob([js], {type: 'text/javascript'});
    const jsURL = URL.createObjectURL(jsBlob);
    const state = this.transaction.state;
    const text = state.sliceDoc();
    convertEVLToHTML(text, xslt, cssURL, jsURL, window.id, html  => toggleHTMLModeCommand2(ide, window, html, cssURL, jsURL));
  }
}

class JSBuffer extends FileBuffer {
  language() {
    return javascript();
  }
}

class XSLTBuffer extends FileBuffer {
  language() {
    return xml();
  }
}

function findFileBuffer(buffers, unifiedPathname) {
  for (const buffer of buffers.values()) {
    if (buffer instanceof FileBuffer && buffer.unifiedPathname === unifiedPathname) {
      return buffer;
    }
  }
  return null;
}

function isFileBuffer(buffer) {
  return buffer instanceof FileBuffer;
}

function isAllCapsBuffer(buffer) {
  return buffer instanceof AllCapsBuffer;
}

function isCSSBuffer(buffer) {
  return buffer instanceof CSSBuffer;
}

function isEVLBuffer(buffer) {
  return buffer instanceof EVLBuffer;
}

function isJSBuffer(buffer) {
  return buffer instanceof JSBuffer;
}

function isXSLTBuffer(buffer) {
  return buffer instanceof XSLTBuffer;
}

export class ListenerBuffer extends Buffer {
  constructor(name) {
    let text = '';
    text += '"Welcome aboard EVLambda."\n';
    text += '"EVLambda is provided \'as is\' and without any warranties."\n';
    text += '"See LICENSE and Terms of Service for details."\n';
    text += '\n';
    text += '> ';
    super(text, undefined, text.length);
    this.name = name;
  }
  static create(buffers, name) {
    const buffer = new ListenerBuffer(name);
    buffers.set(buffer.id, buffer);
    return buffer;
  }
  toolbar(ide, window) {
    //return <FakeWindowToolbar ide={ide} window={window}/>;
    return null;
  }
  bufferMenuEntry() {
    return this.name;
  }
  statusMessage() {
    //return `${this.name} [${transactionDebugInfo(this.transaction)}]`;
    return `${this.name}`;
  }
  language() {
    return evlambda();
  }
}

function findListenerBuffer(buffers, name) {
  for (const buffer of buffers.values()) {
    if (buffer instanceof ListenerBuffer && buffer.name === name) {
      return buffer;
    }
  }
  return null;
}

function isListenerBuffer(buffer) {
  return buffer instanceof ListenerBuffer;
}

/**********/
/* Window */
/**********/

const DISPLAY_RAW = 0;
const DISPLAY_PENDING = 1;
const DISPLAY_HTML = 2;

function defaultDisplayMode(buffer) {
  if (isAllCapsBuffer(buffer) || isEVLBuffer(buffer)) {
    return DISPLAY_PENDING;
  } else {
    return DISPLAY_RAW;
  }
}

class Window {
  static #id = 0;
  constructor(position) {
    this.id = Window.#id++;
    this.position = position;
    this.anchors = new Map();
  }
  static create(windows, position, buffer) {
    const window = new Window(position);
    window.bufferId = buffer.id;
    window.displayMode = defaultDisplayMode(buffer);
    window.htmlURL = null;
    window.cssURL = null;
    window.jsURL = null;
    windows.set(window.id, window);
    return window;
  }
}

function setWindowBuffer(ide, window, buffer) {
  if (window.displayMode === DISPLAY_HTML) {
    URL.revokeObjectURL(window.htmlURL);
    URL.revokeObjectURL(window.cssURL);
    URL.revokeObjectURL(window.jsURL);
  }
  const displayMode = defaultDisplayMode(buffer);
  const newWindows = new Map(ide.windows);
  newWindows.set(window.id, copyInstance(window, {
    bufferId: buffer.id,
    displayMode: displayMode,
    htmlURL: null,
    cssURL: null,
    jsURL: null
  }));
  ide.setWindows(newWindows);
  if (displayMode === DISPLAY_PENDING) {
    buffer.toggleOnHTMLMode(ide, window);
  }
}

/*******/
/* IDE */
/*******/

function IDE({initialBuffers, initialWindows}) {
  const [windowSize, setWindowSize] = useState(0);
  const [keymap, setKeymap] = useState(rootKeymap);
  const [buffers, setBuffers] = useState(initialBuffers);
  const [windows, setWindows] = useState(initialWindows);
  const [menubarOpenMenu, setMenubarOpenMenu] = useState(null);
  const [selectedWindowId, setSelectedWindowId] = useState(0);
  const [maximizedWindowId, setMaximizedWindowId] = useState(null);
  const [selectedEvaluator, setSelectedEvaluator] = useState('trampolinepp');
  const [minibufferMessage, setMinibufferMessage] = useState('');
  const ide = {
    windowSize, setWindowSize,
    keymap, setKeymap,
    buffers, setBuffers,
    windows, setWindows,
    menubarOpenMenu, setMenubarOpenMenu,
    selectedWindowId, setSelectedWindowId,
    maximizedWindowId, setMaximizedWindowId,
    selectedEvaluator, setSelectedEvaluator,
    minibufferMessage, setMinibufferMessage
  };
  useEffect(() => {
    startEvaluator(ide, selectedEvaluator);
    Array.from(ide.windows.values()).map(window => {
      if (window.displayMode === DISPLAY_PENDING) {
        const buffer = ide.buffers.get(window.bufferId);
        buffer.toggleOnHTMLMode(ide, window);
      }
    });
    focusSelectedWindow(ide, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handler = event => handleResize(ide, event);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  });
  useEffect(() => {
    const handler = event => handleKeyDown(ide, event);
    window.addEventListener('keydown', handler, {capture: true});
    return () => window.removeEventListener('keydown', handler, {capture: true});
  });
  useEffect(() => {
    const handler = event => handleIframeFocus(ide, event);
    window.addEventListener('iframeFocus', handler);
    return () => window.removeEventListener('iframeFocus', handler);
  });
  useEffect(() => {
    const handler = event => handleIframeKeyDown(ide, event);
    window.addEventListener('iframeKeyDown', handler);
    return () => window.removeEventListener('iframeKeyDown', handler);
  });
  return (
    <div id="wrapper">
      <header>
        <Menubar ide={ide}/>
        <Infobar ide={ide}/>
      </header>
      <Section ide={ide}/>
      <footer>
        <MinibufferWindow ide={ide}/>
      </footer>
    </div>
  );
}

function selectedWindowAndBuffer(ide) {
  const selectedWindow = ide.windows.get(ide.selectedWindowId);
  const selectedBuffer = ide.buffers.get(selectedWindow.bufferId);
  return {
    selectedWindow: selectedWindow,
    selectedBuffer: selectedBuffer,
    isFileBuffer: isFileBuffer(selectedBuffer),
    isAllCapsBuffer: isAllCapsBuffer(selectedBuffer),
    isCSSBuffer: isCSSBuffer(selectedBuffer),
    isEVLBuffer: isEVLBuffer(selectedBuffer),
    isJSBuffer: isJSBuffer(selectedBuffer),
    isXSLTBuffer: isXSLTBuffer(selectedBuffer),
    isListenerBuffer: isListenerBuffer(selectedBuffer)
  };
}

function closeMenubar (ide) {
  ide.setMenubarOpenMenu(null);
}

function focusSelectedWindow(ide, delayed = false) {
  function focusElement() {
    const element = document.getElementById(contentsAreaId(ide.selectedWindowId));
    if (element !== null) {
      element.focus();
    }
  };
  if (delayed) {
    setTimeout(() => focusElement(), 50);
  } else {
    focusElement();
  }
}

/*******************/
/* Events Handlers */
/*******************/

function handleBeforeUnload(event) {
  event.preventDefault();
  return (event.returnValue = '');
}

window.addEventListener('beforeunload', handleBeforeUnload);

function handleResize(ide, event) {
  ide.setWindowSize(n => n + 1);
}

const rootKeymap = new Map();

function bindKeySeq(keySeq, command) {
  const keySeqArray = keySeq.split(' ');
  const keySeqLength = keySeqArray.length;
  let keymap = rootKeymap;
  for (let i = 0; i < keySeqLength; i++) {
    let keyEventString = keySeqArray[i];
    let keyEvent = 0;
    while (true) {
      if (keyEventString.startsWith('Alt-')) {
        keyEventString = keyEventString.substring(4);
        keyEvent = keyEvent + 1;
      } else if (keyEventString.startsWith('Ctrl-')) {
        keyEventString = keyEventString.substring(5);
        keyEvent = keyEvent + 2;
      } else if (keyEventString.startsWith('Meta-')) {
        keyEventString = keyEventString.substring(5);
        keyEvent = keyEvent + 4;
      } else if (keyEventString.startsWith('Shift-')) {
        keyEventString = keyEventString.substring(6);
        keyEvent = keyEvent + 8;
      } else {
        keyEvent = keyEvent + keyEventString.charCodeAt(0) * 16;
        break;
      }
    }
    if (i === keySeqLength - 1) {
      keymap.set(keyEvent, command);
    } else {
      if (keymap.has(keyEvent)) {
        const prefixKeymap = keymap.get(keyEvent);
        keymap = prefixKeymap;
      } else {
        const prefixKeymap = new Map();
        keymap.set(keyEvent, prefixKeymap);
        keymap = prefixKeymap;
      }
    }
  }
}

const saveBufferKeySeq = os.name === 'Mac OS' ? 'Meta-s' : 'Ctrl-s';
bindKeySeq(saveBufferKeySeq, ide => {
  const {selectedBuffer, isFileBuffer} = selectedWindowAndBuffer(ide);
  if (fileSystemIsWritable && isFileBuffer) {
    saveBufferCommand(ide, selectedBuffer);
  }
});

const toggleHTMLModeKeySeq = os.name === 'Mac OS' ? 'Ctrl-Meta-h' : 'Ctrl-Alt-h';
bindKeySeq(toggleHTMLModeKeySeq, ide => {
  const {selectedWindow, selectedBuffer, isAllCapsBuffer, isEVLBuffer} = selectedWindowAndBuffer(ide);
  if (isAllCapsBuffer || isEVLBuffer) {
    toggleHTMLModeCommand(ide, selectedWindow, selectedBuffer)
  }
});

const evaluateFormKeySeq = os.name === 'Mac OS' ? 'Ctrl-Meta-e' : 'Ctrl-Alt-e';
bindKeySeq(evaluateFormKeySeq, ide => {
  const {selectedWindow, isEVLBuffer} = selectedWindowAndBuffer(ide);
  if (isEVLBuffer) {
    evaluateFormCommand(ide, selectedWindow);
  }
});

const loadBufferKeySeq = os.name === 'Mac OS' ? 'Ctrl-Meta-l' : 'Ctrl-Alt-l';
bindKeySeq(loadBufferKeySeq, ide => {
  const {selectedBuffer, isEVLBuffer} = selectedWindowAndBuffer(ide);
  if (isEVLBuffer) {
    loadBufferCommand(ide, selectedBuffer);
  }
});

const selectOtherWindowKeySeq = os.name === 'Mac OS' ? 'Ctrl-Meta-o' : 'Ctrl-Alt-o';
bindKeySeq(selectOtherWindowKeySeq, ide => {
  const selectedWindow = ide.windows.get(ide.selectedWindowId);
  if (ide.maximizedWindowId === null) {
    selectOtherWindowCommand(ide, selectedWindow);
  }
});

const toggleMaximizedStateKeySeq = os.name === 'Mac OS' ? 'Ctrl-Meta-m' : 'Ctrl-Alt-m';
bindKeySeq(toggleMaximizedStateKeySeq, ide => {
  const selectedWindow = ide.windows.get(ide.selectedWindowId);
  toggleMaximizedStateCommand(ide, selectedWindow);
});

function handleKeyDown(ide, event) {
  if (sharedHandleKeyDown(ide, event.key, event.altKey, event.ctrlKey, event.metaKey, event.shiftKey)) {
    event.stopPropagation();
    event.preventDefault();
  }
}

function sharedHandleKeyDown(ide, key, altKey, ctrlKey, metaKey, shiftKey) {
  const keymap = ide.keymap;
  let keyEvent = null;
  if (key.length === 1) {
    keyEvent = 0;
    if (altKey) {
      keyEvent = keyEvent + 1;
    }
    if (ctrlKey) {
      keyEvent = keyEvent + 2;
    }
    if (metaKey) {
      keyEvent = keyEvent + 4;
    }
    if (shiftKey) {
      keyEvent = keyEvent + 8;
    }
    keyEvent = keyEvent + key.charCodeAt(0) * 16;
  }
  if (keyEvent !== null) {
    const prefixKeymapOrCommand = keymap.get(keyEvent);
    if (prefixKeymapOrCommand instanceof Map) {
      ide.setKeymap(prefixKeymapOrCommand);
      return true;
    } else if (prefixKeymapOrCommand instanceof Function) {
      ide.setKeymap(rootKeymap);
      prefixKeymapOrCommand(ide);
      return true;
    } else if (keymap !== rootKeymap) {
      ide.setKeymap(rootKeymap);
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function handleIframeFocus(ide, event) {
  const windowId = event.detail;
  if (ide.windows.has(windowId)) {
    ide.setSelectedWindowId(windowId);
  }
}

function handleIframeKeyDown(ide, event) {
  const iframeEvent = event.detail;
  sharedHandleKeyDown(ide, iframeEvent.key, iframeEvent.altKey, iframeEvent.ctrlKey, iframeEvent.metaKey, iframeEvent.shiftKey);
}

/***********/
/* Menubar */
/***********/

function Menubar({ide}) {
  return (
    <MenubarRoot value={ide.menubarOpenMenu}
                 onValueChange={ide.setMenubarOpenMenu}>
      <FileMenu ide={ide}/>
      <EditMenu ide={ide}/>
      <EvalMenu ide={ide}/>
      <ViewMenu ide={ide}/>
      <BufferMenu ide={ide}/>
      <HelpMenu ide={ide}/>
    </MenubarRoot>
  );
}

/************/
/* FileMenu */
/************/

function FileMenu({ide}) {
  const [revertBufferMenubarDialogOpen, setRevertBufferMenubarDialogOpen] = useState(false);
  const {selectedBuffer, isFileBuffer} = selectedWindowAndBuffer(ide);
  return (
    <MenubarMenu trigger="File"
                 hidden={revertBufferMenubarDialogOpen}>
      <MenubarItem disabled={!fileSystemIsWritable || !isFileBuffer}
                   onSelect={() => saveBufferCommand(ide, selectedBuffer)}>
        Save Buffer
        <MenubarRightSlot>{saveBufferKeySeq}</MenubarRightSlot>
      </MenubarItem>
      <MenubarDialog open={revertBufferMenubarDialogOpen}
                     onOpenChange={setRevertBufferMenubarDialogOpen}
                     disabled={!isFileBuffer}
                     onClose={() => {closeMenubar(ide); focusSelectedWindow(ide);}}
                     title="Revert Buffer...">
        <p>
          Revert '{selectedBuffer.unifiedPathname}'?
        </p>
        <DialogButtons>
          <DialogDefaultButton onClick={() => {closeMenubar(ide); focusSelectedWindow(ide);}}>
            Cancel
          </DialogDefaultButton>
          <DialogButton onClick={() => revertBufferCommand(ide, selectedBuffer)}>
            Revert
          </DialogButton>
        </DialogButtons>
      </MenubarDialog>
    </MenubarMenu>
  );
}

function saveBufferCommand(ide, buffer) {
  const unifiedPathname = buffer.unifiedPathname;
  const contents = buffer.transaction.state.doc;
  putFileContents(unifiedPathname,
                  contents.toString(),
                  () => onSaveBufferSuccess(ide, buffer, contents),
                  errorMessage => onSaveBufferFailure(ide, errorMessage));
  focusSelectedWindow(ide);
}

function onSaveBufferSuccess(staleIde, staleBuffer, contents) {
  staleIde.setBuffers(buffers => {
    const buffer = buffers.get(staleBuffer.id);
    const newBuffers = new Map(buffers);
    newBuffers.set(buffer.id, copyInstance(buffer, {
      lastSavedContents: contents,
      modified: !buffer.transaction.state.doc.eq(contents)
    }));
    return newBuffers;
  });
  staleIde.setMinibufferMessage(`Saved '${staleBuffer.unifiedPathname}'.`);
}

function onSaveBufferFailure(staleIde, errorMessage) {
  staleIde.setMinibufferMessage(errorMessage);
}

function revertBufferCommand(ide, buffer) {
  const unifiedPathname = buffer.unifiedPathname;
  if (fileSystemIsWritable) {
    getFileContents(unifiedPathname,
                    contents => onRevertBufferSuccess(ide, buffer, contents),
                    errorMessage => onRevertBufferFailure(ide, errorMessage));
  } else {
    zippedSystemFiles
      .file(unifiedPathnamePathname(unifiedPathname).substring(1))
      .async('string')
      .then(contents => onRevertBufferSuccess(ide, buffer, contents))
      .catch(error => onRevertBufferFailure(ide, error.message));
  }
  closeMenubar(ide);
  focusSelectedWindow(ide);
}

function onRevertBufferSuccess(staleIde, staleBuffer, contents) {
  staleIde.setBuffers(buffers => {
    const buffer = buffers.get(staleBuffer.id);
    const newBuffers = new Map(buffers);
    const changes = {from: 0, to: buffer.transaction.state.doc.length, insert: contents};
    const transaction = buffer.transaction.state.update({changes: changes});
    newBuffers.set(buffer.id, copyInstance(buffer, {
      transaction: transaction,
      lastSavedContents: transaction.state.doc,
      modified: false
    }));
    return newBuffers;
  });
  staleIde.setMinibufferMessage(`Reverted '${staleBuffer.unifiedPathname}'.`);
}

function onRevertBufferFailure(staleIde, errorMessage) {
  staleIde.setMinibufferMessage(errorMessage);
}

/************/
/* EditMenu */
/************/

function EditMenu({ide}) {
  const [clearListenerMenubarDialogOpen, setClearListenerMenubarDialogOpen] = useState(false);
  const {selectedWindow, selectedBuffer, isAllCapsBuffer, isEVLBuffer, isListenerBuffer} = selectedWindowAndBuffer(ide);
  return (
    <MenubarMenu trigger="Edit"
                 hidden={clearListenerMenubarDialogOpen}>
      <MenubarItem disabled={!isAllCapsBuffer && !isEVLBuffer}
                   onSelect={() => toggleHTMLModeCommand(ide, selectedWindow, selectedBuffer)}>
        Toggle HTML Mode
        <MenubarRightSlot>{toggleHTMLModeKeySeq}</MenubarRightSlot>
      </MenubarItem>
      <MenubarDialog open={clearListenerMenubarDialogOpen}
                     onOpenChange={setClearListenerMenubarDialogOpen}
                     disabled={!isListenerBuffer}
                     onClose={() => {closeMenubar(ide); focusSelectedWindow(ide);}}
                     title="Clear Listener...">
        <p>
          Clear '{selectedBuffer.name}'?
        </p>
        <DialogButtons>
          <DialogDefaultButton onClick={() => {closeMenubar(ide); focusSelectedWindow(ide);}}>
            Cancel
          </DialogDefaultButton>
          <DialogButton onClick={() => clearListenerCommand(ide, selectedBuffer)}>
            Clear
          </DialogButton>
        </DialogButtons>
      </MenubarDialog>
    </MenubarMenu>
  );
}

function toggleHTMLModeCommand(ide, window, buffer) {
  switch (window.displayMode) {
    case DISPLAY_RAW: {
      const newWindows = new Map(ide.windows);
      newWindows.set(window.id, copyInstance(window, {
        displayMode: DISPLAY_PENDING
      }));
      ide.setWindows(newWindows);
      buffer.toggleOnHTMLMode(ide, window);
      break;
    }
    case DISPLAY_HTML: {
      URL.revokeObjectURL(window.htmlURL);
      URL.revokeObjectURL(window.cssURL);
      URL.revokeObjectURL(window.jsURL);
      const newWindows = new Map(ide.windows);
      newWindows.set(window.id, copyInstance(window, {
        displayMode: DISPLAY_RAW,
        htmlURL: null,
        cssURL: null,
        jsURL: null
      }));
      ide.setWindows(newWindows);
      break;
    }
  }
  focusSelectedWindow(ide, true);
}

function toggleHTMLModeCommand2(staleIde, staleWindow, html, cssURL, jsURL) {
  staleIde.setWindows(windows => {
    const window = windows.get(staleWindow.id);
    const newWindows = new Map(windows);
    const htmlBlob = new Blob([html], {type: 'text/html'});
    const htmlURL = URL.createObjectURL(htmlBlob);
    newWindows.set(window.id, copyInstance(window, {
      displayMode: DISPLAY_HTML,
      htmlURL: htmlURL,
      cssURL: cssURL,
      jsURL: jsURL
    }));
    return newWindows;
  });
  focusSelectedWindow(staleIde, true);
}

function clearListenerCommand(ide, buffer) {
  clearListener(ide, buffer);
  closeMenubar(ide);
  focusSelectedWindow(ide);
}

/************/
/* EvalMenu */
/************/

function EvalMenu({ide}) {
  const [restartEvaluatorMenubarDialogOpen, setRestartEvaluatorMenubarDialogOpen] = useState(false);
  const [selectedEvaluator, setSelectedEvaluator] = useState(ide.selectedEvaluator);
  const {selectedWindow, selectedBuffer, isEVLBuffer} = selectedWindowAndBuffer(ide);
  return (
    <MenubarMenu trigger="Eval"
                 hidden={restartEvaluatorMenubarDialogOpen}>
      <MenubarItem disabled={!isEVLBuffer}
                   onSelect={() => evaluateFormCommand(ide, selectedWindow)}>
        Evaluate Form
        <MenubarRightSlot>{evaluateFormKeySeq}</MenubarRightSlot>
      </MenubarItem>
      <MenubarItem disabled={!isEVLBuffer}
                   onSelect={() => loadBufferCommand(ide, selectedBuffer)}>
        Load Buffer
        <MenubarRightSlot>{loadBufferKeySeq}</MenubarRightSlot>
      </MenubarItem>
      <MenubarSeparator/>
      <MenubarItem onSelect={() => abortEvaluationCommand(ide)}>
        Abort Evaluation
      </MenubarItem>
      <MenubarDialog open={restartEvaluatorMenubarDialogOpen}
                     onOpenChange={setRestartEvaluatorMenubarDialogOpen}
                     onClose={() => {closeMenubar(ide); focusSelectedWindow(ide);}}
                     title="Restart Evaluator...">
        <ul className="radio">
          {Array.from(evaluatorNames.entries()).map(([evaluatorName, evaluatorDisplayName]) =>
            <li key={evaluatorName}
                className="radio">
              <input id={evaluatorName}
                     type="radio"
                     name="evaluatorName"
                     value={evaluatorName}
                     checked={evaluatorName === selectedEvaluator}
                     onChange={() => setSelectedEvaluator(evaluatorName)}/>
              <label htmlFor={evaluatorName}>
                {evaluatorDisplayName}
              </label>
            </li>
          )}
        </ul>
        <DialogButtons>
          <DialogDefaultButton onClick={() => {closeMenubar(ide); focusSelectedWindow(ide);}}>
            Cancel
          </DialogDefaultButton>
          <DialogButton onClick={() => restartEvaluatorCommand(ide, selectedEvaluator)}>
            Restart
          </DialogButton>
        </DialogButtons>
      </MenubarDialog>
    </MenubarMenu>
  );
}

function evaluateFormCommand(ide, window) {
  const state = window.view.state;
  const form = findForm(state, state.selection.main.anchor);
  if (form !== null) {
    const text = state.sliceDoc(form.from, form.to);
    evaluateFirstForm(text, response => ide.setMinibufferMessage(formatForMinibuffer(response)));
  }
  focusSelectedWindow(ide);
}

function loadBufferCommand(ide, buffer) {
  const state = buffer.transaction.state;
  const text = state.sliceDoc();
  evaluateAllForms(text, response  => ide.setMinibufferMessage(formatForMinibuffer(response)));
  focusSelectedWindow(ide);
}

function abortEvaluationCommand(ide) {
  abortEvaluation();
  focusSelectedWindow(ide);
}

function restartEvaluatorCommand(ide, selectedEvaluator) {
  ide.setSelectedEvaluator(selectedEvaluator);
  startEvaluator(ide, selectedEvaluator);
  closeMenubar(ide);
  focusSelectedWindow(ide);
}

function startEvaluator(ide, selectedEvaluator) {
  createEvaluator(
    findFileBuffer(ide.buffers, '/system/core.js').transaction.state.sliceDoc(),
    selectedEvaluator,
    Array.from(ide.buffers.values()).filter(isEVLBuffer).map(buffer => buffer.transaction.state.sliceDoc()),
    response => ide.setMinibufferMessage(formatForMinibuffer(response))
  );
}

/************/
/* ViewMenu */
/************/

function ViewMenu({ide}) {
  const selectedWindow = ide.windows.get(ide.selectedWindowId);
  return (
    <MenubarMenu trigger="View">
      <MenubarItem disabled={ide.maximizedWindowId !== null}
                   onSelect={() => selectOtherWindowCommand(ide, selectedWindow)}>
        Select Other Window
        <MenubarRightSlot>{selectOtherWindowKeySeq}</MenubarRightSlot>
      </MenubarItem>
      <MenubarItem onSelect={() => toggleMaximizedStateCommand(ide, selectedWindow)}>
        Toggle Maximized State
        <MenubarRightSlot>{toggleMaximizedStateKeySeq}</MenubarRightSlot>
      </MenubarItem>
    </MenubarMenu>
  );
}

function selectOtherWindowCommand(ide, window) {
  const windowIds = Array.from(ide.windows.keys());
  let otherWindowId = windowIds[0];
  for (const windowId of windowIds) {
    if (windowId > window.id) {
      otherWindowId = windowId;
      break;
    }
  }
  document.getElementById(contentsAreaId(otherWindowId)).focus();
}

function toggleMaximizedStateCommand (ide, window) {
  if (ide.maximizedWindowId === null) {
    ide.setMaximizedWindowId(window.id);
  } else {
    ide.setMaximizedWindowId(null);
  }
  focusSelectedWindow(ide);
}

/**************/
/* BufferMenu */
/**************/

function BufferMenu({ide}) {
  const selectedWindow = ide.windows.get(ide.selectedWindowId);
  return (
    <MenubarMenu trigger="Buffers">
      <MenubarRadioGroup value={selectedWindow.bufferId}>
        {Array.from(ide.buffers.values()).map(buffer =>
          <MenubarRadioItem key={buffer.id}
                            value={buffer.id}
                            onSelect={() => selectBufferCommand(ide, selectedWindow, buffer)}>
            {buffer.bufferMenuEntry()}
          </MenubarRadioItem>
        )}
      </MenubarRadioGroup>
    </MenubarMenu>
  );
}

function selectBufferCommand(ide, window, buffer) {
  setWindowBuffer(ide, window, buffer);
  focusSelectedWindow(ide, true);
}

/************/
/* HelpMenu */
/************/

function HelpMenu({ide}) {
  return (
    <MenubarMenu trigger="Help">
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org')}>
        Home
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/changelog.php')}>
        Changelog
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/contact.php')}>
        Contact
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/my-account/login.php')}>
        My Account
      </MenubarItem>
      <MenubarSeparator/>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/gitweb/gitweb.cgi?p=evlambda.git')}>
        Git Repository
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://discourse.evlambda.org')}>
        Discussions
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://discourse.evlambda.org/issues')}>
        Issues
      </MenubarItem>
      <MenubarSeparator/>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/cookie-policy.php')}>
        Cookie Policy
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/privacy-policy.php')}>
        Privacy Policy
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/terms-of-service.php')}>
        Terms of Service
      </MenubarItem>
      <MenubarItem onSelect={() => openLinkCommand(ide, 'https://evlambda.org/credits.php')}>
        Credits
      </MenubarItem>
      <MenubarSeparator/>
      <MenubarItem onSelect={() => openLinkCommand(ide, '/ide/bom.html')}>
        Bill of Materials
      </MenubarItem>
    </MenubarMenu>
  );
}

function openLinkCommand(ide, link) {
  open(link, '_blank');
  focusSelectedWindow(ide);
}

/***********/
/* Infobar */
/***********/

function Infobar({ide}) {
  return (
    <InfobarRoot>
      <InfobarItem>
        {evaluatorNames.get(ide.selectedEvaluator)}
      </InfobarItem>
    </InfobarRoot>
  );
}

/***********/
/* Section */
/***********/

function Section({ide}) {
  const sectionRef = useRef(null);
  const [sectionRectangle, setSectionRectangle] = useState(null);
  useLayoutEffect(() => {
    setTimeout(() => {
      setSectionRectangle(sectionRef.current.getBoundingClientRect());
    }, 0);
  }, [ide.windowSize]);
  return (
    <section ref={sectionRef}>
      {Array.from(ide.windows.values()).map(window => {
        const buffer = ide.buffers.get(window.bufferId);
        return (
          <TilingWindow key={window.id + '.' + buffer.id + '.' + window.displayMode}
                        onFocus={() => ide.setSelectedWindowId(window.id)}
                        sectionRectangle={sectionRectangle}
                        position={ide.maximizedWindowId === null ? window.position : (ide.maximizedWindowId === window.id ? '' : null)}>
            {buffer.toolbar(ide, window)}
            <WindowContentsArea>
              <ContentsAreaRoot>
                {buffer.contentsArea(ide, window)}
              </ContentsAreaRoot>
            </WindowContentsArea>
            <WindowStatusbar>
              <StatusbarRoot dataSelected={window.id === ide.selectedWindowId ? '' : null}>
                {buffer.statusMessage()}
              </StatusbarRoot>
            </WindowStatusbar>
          </TilingWindow>
        );
      })}
    </section>
  );
}

/*********************/
/* FakeWindowToolbar */
/*********************/

function FakeWindowToolbar ({ide, window}) {
  return (
    <WindowToolbar>
      <ToolbarRoot dataSelected={window.id === ide.selectedWindowId ? '' : null}>
        <ToolbarButton onClick={() => ide.setMinibufferMessage('XXX')}>
          XXX
        </ToolbarButton>
        <ToolbarButton onClick={() => ide.setMinibufferMessage('YYY')}>
          YYY
        </ToolbarButton>
        <ToolbarButton onClick={() => ide.setMinibufferMessage('ZZZ')}>
          ZZZ
        </ToolbarButton>
      </ToolbarRoot>
    </WindowToolbar>
  );
}

/********************/
/* MinibufferWindow */
/********************/

function MinibufferWindow({ide}) {
  return (
    <FillingWindow>
      <WindowContentsArea>
        <ContentsAreaRoot>
          <Minibuffer message={ide.minibufferMessage}/>
        </ContentsAreaRoot>
      </WindowContentsArea>
    </FillingWindow>
  );
}

/******************/
/* Initialization */
/******************/

let fileSystemIsWritable = null;
let zippedSystemFiles = null;

function init(systemFiles) {
  const buffers = new Map();
  const url = new URL('/fs/system/get-capabilities', window.location.href);
  fetch(url)
    .then(response => {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error('/fs/system/get-capabilities');
      }
    })
    .then(json => {
      fileSystemIsWritable = json.writable;
      if (fileSystemIsWritable) {
        return Promise.all(systemFiles.map(systemFile => {
          const url = new URL('/fs/system/get-file-contents', window.location.href);
          url.searchParams.set('pathname', '/' + systemFile);
          return fetch(url)
            .then(response => {
              if (response.ok) {
                return response.text();
              } else {
                throw new Error('/fs/system/get-file-contents');
              }
            })
            .then(text => {
              return text;
            });
        }));
      } else {
        const url = new URL('/ide/system-files.zip', window.location.href);
        return fetch(url)
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error('/ide/system-files.zip');
            }
          })
          .then(arrayBuffer => {
            return JSZip.loadAsync(arrayBuffer);
          })
          .then(zip => {
            zippedSystemFiles = zip;
            return Promise.all(systemFiles.map(systemFile => zip.file(systemFile).async('string')));
          });
      }
    })
    .then(systemFilesContents => {
      for (let i = 0; i < systemFiles.length; i++) {
        FileBuffer.create(buffers, '/system/' + systemFiles[i], systemFilesContents[i]);
      }
      ListenerBuffer.create(buffers, 'Listener 1');
      const windows = new Map();
      Window.create(windows, 'L', findFileBuffer(buffers, '/system/USER-MANUAL'));
      Window.create(windows, 'R', findListenerBuffer(buffers, 'Listener 1'));
      createRoot(document.querySelector('#root')).render(<IDE initialBuffers={buffers} initialWindows={windows}/>);
    })
    .catch(error => {
      document.body.innerHTML = '<p class="error">The application failed to initialize.</p>';
    });
}

init([
  'USER-MANUAL',
  'TUTORIAL',
  'REFERENCE-MANUAL',
  'IMPLEMENTATION-NOTES',
  'BIBLIOGRAPHY',
  'LICENSE',
  'all-caps.css',
  'all-caps.js',
  'core.js',
  'evl2html.xslt',
  'evl2html.css',
  'evl2html.js',
  'mantle.evl'
]);
