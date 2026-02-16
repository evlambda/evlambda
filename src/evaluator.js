// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import {
  htmlEscape
} from './utilities.js';

const FOUND_NO_FORM = 0;
const SUCCESS = 1;
const ERROR = 2;
const ABORTED = 3;
const TERMINATED = 4;

const INITIALIZE = 0;
const EVALUATE_FIRST_FORM = 1;
const EVALUATE_ALL_FORMS = 2;
const CONVERT_EVL_TO_XML = 3;

export const evaluatorNames = new Map([
  ['plainrec', 'Plain Recursive'],
  ['cps', 'Continuation Passing Style'],
  ['oocps', 'Object-Oriented CPS'],
  ['sboocps', 'Stack-Based Object-Oriented CPS'],
  ['trampoline', 'Trampoline'],
  ['trampolinepp', 'Trampoline++']
]);

let evaluator = null;
let jobId = 0;
const jobs = new Map();
const abortSignalBuffer = new SharedArrayBuffer(1);
const abortSignalArray = new Uint8Array(abortSignalBuffer);

abortSignalArray[0] = 0;

// => {id, action, input}
// <= {id, status, output}

function sendRequest(action, input, callback = null) {
  const id = jobId++;
  evaluator.postMessage({id: id, action: action, input: input});
  if (callback !== null) {
    jobs.set(id, callback);
  }
}

export function createEvaluator(jsFile, selectedEvaluator, evlFiles, callback) {
  if (evaluator !== null) {
    evaluator.terminate();
  }
  for (const [id, callback] of jobs) {
    callback({id: id, status: TERMINATED});
  }
  jobs.clear();
  const blob = new Blob([jsFile], {type: 'text/javascript'});
  const url = URL.createObjectURL(blob);
  evaluator = new Worker(url);
  URL.revokeObjectURL(url);
  evaluator.onerror = (event) => {
    console.log('ERROR CREATING EVALUATOR ' + event.lineno + ' ' + event.colno + ' ' + event.message);
  }
  evaluator.onmessage = (event) => {
    const callback = jobs.get(event.data.id);
    if (callback !== undefined) {
      jobs.delete(event.data.id);
      callback(event.data);
    }
  }
  sendRequest(INITIALIZE, {abortSignalBuffer, selectedEvaluator, evlFiles}, callback);
}

export function evaluateFirstForm(text, callback) {
  sendRequest(EVALUATE_FIRST_FORM, text , callback);
}

export function evaluateAllForms(text, callback) {
  sendRequest(EVALUATE_ALL_FORMS, text, callback);
}

export function convertEVLToHTML(text, xsltString, cssURL, jsURL, windowId, callback) {
  sendRequest(CONVERT_EVL_TO_XML, text, response => {
    let result = null;
    try {
      switch (response.status) {
        case SUCCESS:
          const parser = new DOMParser();
          const processor = new XSLTProcessor();
          const serializer = new XMLSerializer();
          const xsltDocument = parser.parseFromString(xsltString, 'application/xml');
          processor.importStylesheet(xsltDocument);
          processor.setParameter(null, 'cssURL', cssURL);
          processor.setParameter(null, 'jsURL', jsURL);
          processor.setParameter(null, 'windowId', windowId);
          const xmlString = response.output;
          const xmlDocument = parser.parseFromString(xmlString, 'application/xml');
          const htmlDocument = processor.transformToDocument(xmlDocument);
          const htmlString = serializer.serializeToString(htmlDocument);
          //console.log(xmlString);
          //console.log(htmlString);
          result = htmlString;
          break;
        case ERROR:
          result = errorPage(`ERROR: ${response.output}`, cssURL, jsURL, windowId);
          break;
        case ABORTED:
          result = errorPage('ABORTED', cssURL, jsURL, windowId);
          break;
        case TERMINATED:
          result = errorPage('TERMINATED', cssURL, jsURL, windowId);
          break;
      }
    } catch(exception) {
      result = errorPage(exception.message, cssURL, jsURL, windowId);
    }
    callback(result);
  });
}

function errorPage(message, cssURL, jsURL, windowId) {
  let html = ''
  html += '<!doctype html>';
  html += '<html>';
  html += '<head>';
  html += '<meta charset="utf-8">';
  html += `<link rel="stylesheet" href="${cssURL}"/>`;
  html += `<script src="${jsURL}"></script>`;
  html += `<script>const windowId = ${windowId};</script>`;
  html += '</head>';
  html += '<body>';
  html += `<p>${htmlEscape(message)}</p>`;
  html += '</body>';
  html += '</html>';
  return html;
}

export function formatForListener(response) {
  switch (response.status) {
    case FOUND_NO_FORM:
      return null;
    case SUCCESS:
      let text = '';
      for (const value of response.output) {
        text = text + value + '\n';
      }
      return text;
    case ERROR:
      return `ERROR: ${response.output}\n`;
    case ABORTED:
      return 'ABORTED\n';
    case TERMINATED:
      return 'TERMINATED\n';
  }
}

export function formatForMinibuffer(response) {
  switch (response.status) {
    case FOUND_NO_FORM:
      return 'FOUND NO FORM';
    case SUCCESS:
      let text = '';
      let first = true;
      for (const value of response.output) {
        if (first) {
          first = false;
        } else {
          text = text + ', ';
        }
        text = text + value.replaceAll('\n', '\u2424'); // SYMBOL FOR NEWLINE
      }
      return text;
    case ERROR:
      return `ERROR: ${response.output}`;
    case ABORTED:
      return 'ABORTED';
    case TERMINATED:
      return 'TERMINATED';
  }
}

export function abortEvaluation() {
  abortSignalArray[0] = 1;
}
