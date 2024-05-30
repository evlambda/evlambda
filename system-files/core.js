// SPDX-FileCopyrightText: Copyright (c) 2024 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

/*************/
/* Interface */
/*************/

const FOUND_NO_FORM = 0;
const COMPLETED_NORMALLY = 1;
const COMPLETED_ABNORMALLY = 2;
const ABORTED = 3;
const TERMINATED = 4;

const INITIALIZE = 0;
const EVALUATE_FIRST_FORM = 1;
const EVALUATE_ALL_FORMS = 2;
const CONVERT_TO_XML = 3;

let signalArray = null;
let selectedEvaluator = null;

if (typeof onmessage !== 'undefined') { // web worker
  onmessage = (event) => {
    const {id, action, input} = event.data;
    let response = null;
    switch (action) {
      case INITIALIZE:
        response = initialize(input);
        break;
      case EVALUATE_FIRST_FORM:
        response = evaluateFirstForm(input);
        break;
      case EVALUATE_ALL_FORMS:
        response = evaluateAllForms(input);
        break;
      case CONVERT_TO_XML:
        response = convertToXML(input);
        break;
    }
    if (response !== null) {
      postMessage({id: id, ...response});
    }
  };
}

function foundNoForm() {
  return {status: FOUND_NO_FORM};
}

function completedNormally(output) {
  return {status: COMPLETED_NORMALLY, output: output};
}

function completedAbnormally(exception) {
  if (exception instanceof Aborted) {
    return {status: ABORTED};
  } else {
    return {status: COMPLETED_ABNORMALLY, output: exception.message};
  }
}

function initialize(input) {
  signalArray = new Uint8Array(input.signalBuffer);
  signalArray[0] = 0;
  selectedEvaluator = input.selectedEvaluator;
  GlobalEnv.set(VAL_NS, internVariable('*features*'), new EVLCons(internVariable(selectedEvaluator), EVLEmptyList.NIL));
  let lastResult = EVLVoid.VOID;
  for (const evlFile of input.evlFiles) {
    const lexer = new Lexer(evlFile);
    lexer.callback = object => lastResult = genericEval(object);
    while (true) {
      let object = null;
      try {
        object = read(lexer);
      } catch(exception) {
        return completedAbnormally(exception);
      }
      if (object === null) {
        break;
      } else {
        try {
          lastResult = genericEval(object);
        } catch(exception) {
          return completedAbnormally(exception);
        }
      }
    }
  }
  const output = lastResult.allValues().map(object => object.toString());
  return completedNormally(output);
}

function evaluateFirstForm(text) {
  signalArray[0] = 0;
  const lexer = new Lexer(text);
  let object = null;
  try {
    object = read(lexer);
  } catch(exception) {
    if (exception instanceof UnexpectedEndOfFile) {
      return foundNoForm();
    } else {
      return completedAbnormally(exception);
    }
  }
  if (object === null) {
    return foundNoForm();
  } else {
    let result = null;
    try {
      result = genericEval(object);
    } catch(exception) {
      return completedAbnormally(exception);
    }
    const output = result.allValues().map(object => object.toString());
    return completedNormally(output);
  }
}

function evaluateAllForms(text) {
  signalArray[0] = 0;
  let lastResult = EVLVoid.VOID;
  const lexer = new Lexer(text);
  lexer.callback = object => lastResult = genericEval(object);
  while (true) {
    let object = null;
    try {
      object = read(lexer);
    } catch(exception) {
      return completedAbnormally(exception);
    }
    if (object === null) {
      break;
    } else {
      try {
        lastResult = genericEval(object);
      } catch(exception) {
        return completedAbnormally(exception);
      }
    }
  }
  const output = lastResult.allValues().map(object => object.toString());
  return completedNormally(output);
}

function convertToXML(text) {
  signalArray[0] = 0;
  const lexer = new Lexer(text);
  let xml = null;
  try {
    xml = convert(lexer);
  } catch(exception) {
    return completedAbnormally(exception);
  }
  return completedNormally(xml);
}

/**********/
/* Errors */
/**********/

class CannotHappen extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannotHappen';
  }
}

class Aborted extends Error {
  constructor(message) {
    super(message);
    this.name = 'Aborted';
  }
}

class LexerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LexerError';
  }
}

class ReaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderError';
  }
}

class ConverterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConverterError';
  }
}

class SyntaxAnalyzerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyntaxAnalyzerError';
  }
}

class EvaluatorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluatorError';
  }
}

/*********/
/* Lexer */
/*********/

// lexeme types
const QUOTE = 0;
const QUASIQUOTE = 1;
const UNQUOTE = 2;
const UNQUOTE_SPLICING = 3;
const STRING = 4; // value is an EVLString
const OPENING_PARENTHESIS = 5;
const CLOSING_PARENTHESIS = 6;
const HASH_OPENING_PARENTHESIS = 7;
const HASH_PLUS = 8;
const HASH_MINUS = 9;
const VOID = 10; // value is EVLVoid.VOID
const BOOLEAN = 11; // value is EVLBoolean.TRUE or EVLBoolean.FALSE
const CHARACTER = 12; // value is an EVLCharacter
const XML_START_TAG = 13; // value is an XML element name (javascript string)
const XML_END_TAG = 14; // value is an XML element name (javascript string)
const XML_EMPTY_ELEMENT_TAG = 15; // value is an XML element name (javascript string)
const XML_COMMENT = 16;
const DOT = 17; // the dot of dotted lists
const NUMBER = 18; // value is an EVLNumber
const KEYWORD = 19; // value is an EVLKeyword
const VARIABLE = 20; // value is an EVLVariable
const EOF = 21;

const numberRegExp = /^[+-]?[0-9]+(?:\.[0-9]+)?$/;
const keywordRegExp = /^:[^:]+$/;
const variableRegExp = /^[^:]+$/;

function isValidCharacter(char) {
  const charCode = char.charCodeAt(0);
  return char === '\n' || (0x20 <= charCode && charCode <= 0x7E) || (0xC0 <= charCode && charCode <= 0xFF);
}

function isWhitespaceCharacter(char) {
  return char === '\n' || char === ' ';
}

function isTerminatingCharacter(char) {
  return '\'`,"()#'.includes(char);
}

function isXMLNameCharacter(char) {
  const charCode = char.charCodeAt(0);
  return 0x61 <= charCode && charCode <= 0x7A; // a-z
}

class Lexer {
  constructor(text) {
    this.text = text;
    this.position = 0;
    this.xmlStack = []; // element: XML element name
  }
  readCharacter(position = this.position) {
    const char = this.text.charAt(position);
    if (!isValidCharacter(char)) {
      throw new LexerError('Invalid character.');
    }
    return char;
  }
  commitCharacter(char) {
    this.lexeme += char;
    this.position++;
  }
  nextLexeme() {
    this.whitespace = ''; // whitespace preceding the lexeme
    this.lexeme = '';
    this.type = null;
    this.value = null;
    const pureXML = this.xmlStack.length !== 0 && !['chapter', 'section'].includes(this.xmlStack[this.xmlStack.length - 1])
    this.readWhitespace(pureXML);
    if (this.position === this.text.length) {
      this.type = EOF;
    } else {
      this.readLexeme(pureXML);
    }
  }
  readWhitespace(pureXML) {
    // When pure XML is true, XML character data is treated as whitespace.
    while (true) {
      if (this.position === this.text.length) {
        break;
      }
      const char = this.readCharacter();
      if (pureXML ? char === '<' : !isWhitespaceCharacter(char)) {
        break;
      }
      this.whitespace += char;
      this.position++;
    }
  }
  readLexeme(pureXML) {
    const char = this.readCharacter();
    switch (char) {
      case '\'':
        this.commitCharacter(char);
        this.type = QUOTE;
        break;
      case '`':
        this.commitCharacter(char);
        this.type = QUASIQUOTE;
        break;
      case ',':
        this.commitCharacter(char);
        if (this.position === this.text.length) {
          this.type = UNQUOTE;
        } else {
          const char2 = this.readCharacter();
          if (char2 === '@') {
            this.commitCharacter(char2);
            this.type = UNQUOTE_SPLICING;
          } else {
            this.type = UNQUOTE;
          }
        }
        break;
      case '"':
        this.commitCharacter(char);
        readString(this);
        break;
      case '(':
        this.commitCharacter(char);
        this.type = OPENING_PARENTHESIS;
        break;
      case ')':
        this.commitCharacter(char);
        this.type = CLOSING_PARENTHESIS;
        break;
      case '#':
        this.commitCharacter(char);
        readHashConstruct(this);
        break;
      case '<':
        if (readXMLMarkup(this)) {
          break;
        }
        if (pureXML) {
          throw new LexerError('Malformed XML markup.');
        }
        // fall through ('<' will be read again by readToken)
      default:
        readToken(this);
        if (this.value === '.') {
          this.type = DOT;
        } else if (numberRegExp.test(this.value)) {
          this.type = NUMBER;
          this.value = new EVLNumber(Number.parseFloat(this.value));
        } else if (keywordRegExp.test(this.value)) {
          this.type = KEYWORD;
          this.value = internKeyword(this.value.substring(1));
        } else if (variableRegExp.test(this.value)) {
          this.type = VARIABLE;
          this.value = internVariable(this.value);
        } else {
          throw new LexerError('Malformed token.');
        }
        break;
    }
  }
}

function readString(lexer) {
  lexer.value = '';
  while (true) {
    if (lexer.position === lexer.text.length) {
      throw new LexerError('Truncated string.');
    }
    const char = lexer.readCharacter();
    lexer.commitCharacter(char);
    if (char === '"') {
      break;
    }
    if (char === '\\') {
      if (lexer.position === lexer.text.length) {
        throw new LexerError('Truncated escape sequence.');
      }
      const char2 = lexer.readCharacter();
      lexer.commitCharacter(char2);
      lexer.value += char2;
    } else {
      lexer.value += char;
    }
  }
  lexer.type = STRING;
  lexer.value = new EVLString(lexer.value);
}

function readHashConstruct(lexer) {
  if (lexer.position === lexer.text.length) {
    throw new LexerError('Truncated hash construct.');
  }
  const char = lexer.readCharacter();
  switch (char) {
    case '(':
      lexer.commitCharacter(char);
      lexer.type = HASH_OPENING_PARENTHESIS;
      break;
    case '+':
      lexer.commitCharacter(char);
      lexer.type = HASH_PLUS;
      break;
    case '-':
      lexer.commitCharacter(char);
      lexer.type = HASH_MINUS;
      break;
    case 'v':
      lexer.commitCharacter(char);
      lexer.type = VOID;
      lexer.value = EVLVoid.VOID;
      break;
    case 't':
      lexer.commitCharacter(char);
      lexer.type = BOOLEAN;
      lexer.value = EVLBoolean.TRUE;
      break;
    case 'f':
      lexer.commitCharacter(char);
      lexer.type = BOOLEAN;
      lexer.value = EVLBoolean.FALSE;
      break;
    case '\\':
      readToken(lexer);
      if (lexer.value.length === 1) {
        lexer.type = CHARACTER;
        lexer.value = new EVLCharacter(lexer.value);
      } else {
        throw new LexerError('Undefined character name.');
      }
      break;
    default:
      throw new LexerError('Undefined hash construct.');
  }
}

function readXMLMarkup(lexer) {
  let state = 0;
  let isXMLEndTag = false;
  let isXMLEmptyElementTag = false;
  let isXMLComment = false;
  let name = '';
  let position = lexer.position + 1;
  loop: while (true) {
    if (position === lexer.text.length) {
      return false;
    }
    const char = lexer.readCharacter(position++);
    // <[0]/[100]a[101]b[101]c[101]/[102]>
    // <[0]![200]-[201]-[202]...[202]-[203]-[204]>
    switch (state) {
      case 0:
        if (char === '/') {state = 100; isXMLEndTag = true; break;}
        else if (isXMLNameCharacter(char)) {state = 101; name += char; break;}
        else if (char === '!') {state = 200; isXMLComment = true; break;}
        else return false;
      case 100:
        if (isXMLNameCharacter(char)) {state = 101; name += char; break;}
        else return false;
      case 101:
        if (isXMLNameCharacter(char)) {name += char; break;}
        else if (char === '/') {state = 102; isXMLEmptyElementTag = true; break;}
        else if (char === '>') break loop;
        else return false;
      case 102:
        if (ch === '>') break loop;
        else return false;
      case 200:
        if (char === '-') {state = 201; break}
        else return false;
      case 201:
        if (char === '-') {state = 202; break}
        else return false;
      case 202:
        if (char === '-') {state = 203; break}
        else break;
      case 203:
        if (char === '-') {state = 204; break}
        else {state = 202; break}
      case 204:
        if (char === '>') break loop;
        else return false;
    }
  }
  if (isXMLEndTag && isXMLEmptyElementTag) {
    return false;
  }
  lexer.lexeme = lexer.text.slice(lexer.position, position);
  lexer.position = position;
  if (isXMLComment) {
    lexer.type = XML_COMMENT;
  } else if (isXMLEndTag) {
    if (lexer.xmlStack.length === 0) {
      throw new LexerError('Unexpected XML end tag.');
    }
    if (lexer.xmlStack[lexer.xmlStack.length - 1] !== name) {
      throw new LexerError('Unmatched XML tags.');
    }
    lexer.xmlStack.pop();
    lexer.type = XML_END_TAG;
    lexer.value = name;
  } else if (isXMLEmptyElementTag) {
    lexer.type = XML_EMPTY_ELEMENT_TAG;
    lexer.value = name;
  } else {
    lexer.xmlStack.push(name);
    lexer.type = XML_START_TAG;
    lexer.value = name;
  }
  return true;
}

function readToken(lexer) {
  lexer.value = '';
  while (true) {
    if (lexer.position === lexer.text.length) {
      break;
    }
    const char = lexer.readCharacter();
    if (isWhitespaceCharacter(char) || isTerminatingCharacter(char)) {
      break;
    }
    lexer.commitCharacter(char);
    if (char === '\\') {
      if (lexer.position === lexer.text.length) {
        throw new LexerError('Truncated escape sequence.');
      }
      const char2 = lexer.readCharacter();
      lexer.commitCharacter(char2);
      lexer.value += char2;
    } else {
      lexer.value += char;
    }
  }
}

/**********/
/* Reader */
/**********/

class UnexpectedDot extends ReaderError {
  constructor() {
    super('Unexpected dot.');
    this.name = 'UnexpectedDot';
  }
}

class UnexpectedClosingParenthesis extends ReaderError {
  constructor() {
    super('Unexpected closing parenthesis.');
    this.name = 'UnexpectedClosingParenthesis';
  }
}

class UnexpectedXMLEndTag extends ReaderError {
  constructor() {
    super('Unexpected XML end tag.');
    this.name = 'UnexpectedXMLEndTag';
  }
}

class UnexpectedEndOfFile extends ReaderError {
  constructor() {
    super('Unexpected end-of-file.');
    this.name = 'UnexpectedEndOfFile';
  }
}

function read(lexer) {
  const object = readObject(lexer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      return null;
    default:
      return object;
  }
}

function readObject(lexer) {
  // Returns DOT, CLOSING_PARENTHESIS, XML_END_TAG, EOF, or an object.
  // XML elements are skipped because they are treated as comments.
  while (true) {
    lexer.nextLexeme();
    switch (lexer.type) {
      case VOID:
      case BOOLEAN:
      case NUMBER:
      case CHARACTER:
      case STRING:
      case KEYWORD:
      case VARIABLE:
        return lexer.value;
      case QUOTE:
        return readAbbreviation(lexer, quoteVariable);
      case QUASIQUOTE:
        return readAbbreviation(lexer, quasiquoteVariable);
      case UNQUOTE:
        return readAbbreviation(lexer, unquoteVariable);
      case UNQUOTE_SPLICING:
        return readAbbreviation(lexer, unquoteSplicingVariable);
      case HASH_PLUS: {
        const object = readReadTimeConditional(lexer, true);
        if (object !== null) {
          return object;
        } else {
          break;
        }
      }
      case HASH_MINUS: {
        const object = readReadTimeConditional(lexer, false);
        if (object !== null) {
          return object;
        } else {
          break;
        }
      }
      case OPENING_PARENTHESIS:
        return readList(lexer);
      case HASH_OPENING_PARENTHESIS:
        return readVector(lexer);
      case DOT:
        return DOT;
      case CLOSING_PARENTHESIS:
        return CLOSING_PARENTHESIS;
      case XML_START_TAG:
        readXMLElement(lexer);
        break; // skip
      case XML_END_TAG:
        return XML_END_TAG;
      case XML_EMPTY_ELEMENT_TAG:
        break; // skip
      case XML_COMMENT:
        break; // skip
      case EOF:
        return EOF;
      default:
        throw new CannotHappen('readObject');
    }
  }
}

function readAbbreviation(lexer, variable) {
  const object = readObject(lexer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      throw new UnexpectedEndOfFile();
    default:
      return new EVLCons(variable, new EVLCons(object, EVLEmptyList.NIL));
  }
}

function readReadTimeConditional(lexer, polarity) {
  const featureExpression = readReadTimeConditionalFeatureExpression(lexer);
  if (evaluateFeatureExpression(featureExpression) === polarity) {
    return readReadTimeConditionalObject(lexer);
  } else {
    return readReadTimeConditionalObject(lexer), null;
  }
}

function readReadTimeConditionalFeatureExpression(lexer) {
  const object = readObject(lexer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      throw new UnexpectedEndOfFile();
    default:
      return object;
  }
}

function readReadTimeConditionalObject(lexer) {
  const object = readObject(lexer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      throw new UnexpectedEndOfFile();
    default:
      return object;
  }
}

function evaluateFeatureExpression(featureExpression) {
  if (featureExpression instanceof EVLSymbol) {
    return evaluateSymbolFeatureExpression(featureExpression);
  } else if (featureExpression instanceof EVLCons) {
    switch (featureExpression.car) {
      case notVariable:
        return evaluateNotFeatureExpression(featureExpression);
      case andVariable:
        return evaluateAndFeatureExpression(featureExpression);
      case orVariable:
        return evaluateOrFeatureExpression(featureExpression);
      default:
        throw new ReaderError('Malformed feature expression.');
    }
  } else {
    throw new ReaderError('Malformed feature expression.');
  }
}

function evaluateSymbolFeatureExpression(featureExpression) {
  let list = GlobalEnv.ref(VAL_NS, internVariable('*features*'));
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      if (list.car === featureExpression) {
        return true;
      } else {
        list = list.cdr;
      }
    } else {
      throw new ReaderError('Malformed feature list.');
    }
  }
  return false;
}

function evaluateNotFeatureExpression(featureExpression) {
  let operands = featureExpression.cdr;
  if (!(operands instanceof EVLCons) || operands.cdr !== EVLEmptyList.NIL) {
    throw new ReaderError('Malformed feature expression.');
  }
  return !evaluateFeatureExpression(operands.car);
}

function evaluateAndFeatureExpression(featureExpression) {
  let operands = featureExpression.cdr;
  while (operands !== EVLEmptyList.NIL) {
    if (operands instanceof EVLCons) {
      if (evaluateFeatureExpression(operands.car)) {
        operands = operands.cdr;
      } else {
        return false;
      }
    } else {
      throw new ReaderError('Malformed feature expression.');
    }
  }
  return true;
}

function evaluateOrFeatureExpression(featureExpression) {
  let operands = featureExpression.cdr;
  while (operands !== EVLEmptyList.NIL) {
    if (operands instanceof EVLCons) {
      if (evaluateFeatureExpression(operands.car)) {
        return true;
      } else {
        operands = operands.cdr;
      }
    } else {
      throw new ReaderError('Malformed feature expression.');
    }
  }
  return false;
}

function readList(lexer) {
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  loop: while (true) {
    const object = readObject(lexer);
    switch (object) {
      case DOT:
        return readDottedList(lexer, list, lastCons);
      case CLOSING_PARENTHESIS:
        break loop;
      case XML_END_TAG:
        throw new UnexpectedXMLEndTag();
      case EOF:
        throw new UnexpectedEndOfFile();
      default:
        const newCons = new EVLCons(object, EVLEmptyList.NIL);
        if (lastCons === null) {
          list = newCons;
        } else {
          lastCons.cdr = newCons;
        }
        lastCons = newCons;
        break;
    }
  }
  return list;
}

function readDottedList(lexer, list, lastCons) {
  if (lastCons === null) {
    throw new ReaderError('Malformed dotted list.');
  }
  const object = readObject(lexer);
  switch (object) {
    case DOT:
      throw new ReaderError('Malformed dotted list.');
    case CLOSING_PARENTHESIS:
      throw new ReaderError('Malformed dotted list.');
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      throw new UnexpectedEndOfFile();
    default:
      lastCons.cdr = object;
      break
  }
  const object2 = readObject(lexer);
  switch (object2) {
    case DOT:
      throw new ReaderError('Malformed dotted list.');
    case CLOSING_PARENTHESIS:
      return list;
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOF:
      throw new UnexpectedEndOfFile();
    default:
      throw new ReaderError('Malformed dotted list.');
  }
}

function readVector(lexer) {
  const elements = [];
  loop: while (true) {
    const object = readObject(lexer);
    switch (object) {
      case DOT:
        throw new UnexpectedDot();
      case CLOSING_PARENTHESIS:
        break loop;
      case XML_END_TAG:
        throw new UnexpectedXMLEndTag();
      case EOF:
        throw new UnexpectedEndOfFile();
      default:
        elements.push(object);
        break;
    }
  }
  return new EVLVector(elements);
}

function readXMLElement(lexer) {
  const xmlStartTagName = lexer.value;
  loop: while (true) {
    const object = readObject(lexer);
    switch (object) {
      case DOT:
        throw new UnexpectedDot();
      case CLOSING_PARENTHESIS:
        throw new UnexpectedClosingParenthesis();
      case XML_END_TAG:
        const xmlEndTagName = lexer.value;
        if (xmlStartTagName === xmlEndTagName) {
          break loop;
        } else {
          throw new ReaderError('Unmatched XML tags.');
        }
      case EOF:
        throw new UnexpectedEndOfFile();
      default:
        const callback = lexer.callback;
        if (callback !== undefined) {
          callback(object);
        }
        break;
    }
  }
}

/*************/
/* Converter */
/*************/

const TOPLEVEL = 100; // top level context
const ABBREVIATION = 101; // abbreviation context
const RTC1 = 102; // context between #+ or #- and feature expression
const RTC2 = 103; // context between feature expression and object
const SEQUENCE = 104; // list or vector context

const ABSTRACT_BOF = 0; // beginning-of-file lexeme
const ABSTRACT_EVL = 1; // EVL lexeme
const ABSTRACT_XML = 2; // XML lexeme
const ABSTRACT_EOL_COMMENT = 3; // end-of-line comment
const ABSTRACT_EOF = 4; // end-of-file lexeme

function convert(lexer) {
  let xml = '';
  const contextStack = [TOPLEVEL]; // element: TOPLEVEL, ABBREVIATION, RTC1, RTC2, SEQUENCE, or XML element name
  let previousAbstractLexeme = ABSTRACT_BOF;
  let context = TOPLEVEL;
  let abstractLexeme = null;
  while ((abstractLexeme = abstractRead(lexer, contextStack)) !== ABSTRACT_EOF) {
    if (context === TOPLEVEL) {
      // BOF   <evl-object|xml-element>   <evl-object|xml-element>   EOF
      //    ^^^                        ^^^                        ^^^
      xml += lexer.whitespace; // whitespace is written as is
    } else if ([ABBREVIATION, RTC1, RTC2, SEQUENCE].includes(context)) {
      // '   <xml-element>   <xml-element>   <evl-object>
      //  ^^^             ^^^             ^^^
      // #+   <xml-element>   <xml-element>   <evl-object>   <xml-element>   <xml-element>   <evl-object>
      //   ^^^             ^^^             ^^^
      // #+   <xml-element>   <xml-element>   <evl-object>   <xml-element>   <xml-element>   <evl-object>
      //                                                  ^^^             ^^^             ^^^
      // (   <evl-object|xml-element>   <xml-element|xml-element>   )
      //  ^^^                        ^^^                         ^^^
      xml += convertEVL(previousAbstractLexeme, lexer.whitespace, abstractLexeme); // whitespace is converted by convertEVL
    } else if (['chapter', 'section'].includes(context)) {
      // <chapter>   <evl-object|xml-element>   <evl-object|xml-element>   </chapter>
      //          ^^^                        ^^^                        ^^^
      // <section>   <evl-object|xml-element>   <evl-object|xml-element>   </section>
      //          ^^^                        ^^^                        ^^^
      xml += convertXML(previousAbstractLexeme, lexer.whitespace, abstractLexeme); // whitespace is converted by convertXML
    } else {
      // <para>   <xml-element>   <xml-element>   </para>
      //       ^^^             ^^^             ^^^
      xml += lexer.whitespace; // whitespace (= character data) is written as is
    }
    if (abstractLexeme === ABSTRACT_EVL) {
      xml += xmlEscape(lexer.lexeme); // lexeme is xml escaped
    } else {
      xml += lexer.lexeme; // lexeme is written as is
    }
    previousAbstractLexeme = abstractLexeme;
    context = contextStack[contextStack.length - 1];
  }
  xml += lexer.whitespace; // whitespace is written as is
  return xml;
}

// Example: BOF[1]<chapter>[2]([3]xxx[4])[5]</chapter>[6]EOF
// whitespace [1] is processed in top level context
// whitespace [2] is processed in chapter context
// whitespace [3] is processed in sequence context
// whitespace [4] is processed in sequence context
// whitespace [5] is processed in chapter context
// whitespace [6] is processed in top level context

function xmlEscape(string) {
  return string.replace(/[<>&]/g, function (char) {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
    }
  });
}

function abstractRead(lexer, contextStack) {
  lexer.nextLexeme();
  switch (lexer.type) {
    case VOID:
    case BOOLEAN:
    case NUMBER:
    case CHARACTER:
    case STRING:
    case KEYWORD:
    case VARIABLE:
      updateContextStackForEVLObject(contextStack);
      return ABSTRACT_EVL;
    case QUOTE:
    case QUASIQUOTE:
    case UNQUOTE:
    case UNQUOTE_SPLICING:
      contextStack.push(ABBREVIATION); // enter abbreviation context
      return ABSTRACT_EVL;
    case HASH_PLUS:
    case HASH_MINUS:
      contextStack.push(RTC1); // enter rtc1 context
      return ABSTRACT_EVL;
    case OPENING_PARENTHESIS:
    case HASH_OPENING_PARENTHESIS:
      contextStack.push(SEQUENCE); // enter sequence context
      return ABSTRACT_EVL;
    case DOT:
      return ABSTRACT_EVL;
    case CLOSING_PARENTHESIS:
      if (contextStack[contextStack.length - 1] !== SEQUENCE) {
        throw new ConverterError('Unexpected closing parenthesis.');
      }
      contextStack.pop(); // exit sequence context
      updateContextStackForEVLObject(contextStack);
      return ABSTRACT_EVL;
    case XML_START_TAG:
      if (lexer.value === 'comment') {
        abstractReadEndOfLineComment(lexer, contextStack);
        return ABSTRACT_EOL_COMMENT;
      } else {
        contextStack.push(lexer.value); // enter XML element name context
        return ABSTRACT_XML;
      }
    case XML_END_TAG:
      if (typeof contextStack[contextStack.length - 1] !== 'string') {
        throw new ConverterError('Unexpected XML end tag.');
      }
      if (contextStack[contextStack.length - 1] !== lexer.value) {
        throw new ConverterError('Unmatched XML tags.');
      }
      contextStack.pop(); // exit XML element name context
      return ABSTRACT_XML;
    case XML_EMPTY_ELEMENT_TAG:
      return ABSTRACT_XML;
    case XML_COMMENT:
      return ABSTRACT_XML;
    case EOF:
      if (contextStack[contextStack.length - 1] !== TOPLEVEL) {
        throw new ConverterError('Unexpected end-of-file.');
      }
      contextStack.pop(); // exit top level context
      return ABSTRACT_EOF;
    default:
      throw new CannotHappen('abstractRead');
  }
}

function updateContextStackForEVLObject(contextStack) {
  while (true) {
    switch (contextStack[contextStack.length - 1]) {
      case ABBREVIATION:
        contextStack.pop(); // exit abbreviation context
        break;
      case RTC1:
        contextStack.pop(); // exit rtc1 context
        contextStack.push(RTC2); // enter rtc2 context
        return;
      case RTC2:
        contextStack.pop(); // exit rtc2 context
        break;
      default:
        return;
    }
  }
}

function abstractReadEndOfLineComment(lexer) {
  const whitespace = lexer.whitespace;
  let lexeme = lexer.lexeme;
  const contextStack = [lexer.value]; // local stack
  while (true) {
    lexer.nextLexeme();
    switch (lexer.type) {
      case XML_START_TAG:
        lexeme += lexer.whitespace;
        lexeme += lexer.lexeme;
        contextStack.push(lexer.value);
        break;
      case XML_END_TAG:
        if (contextStack[contextStack.length - 1] !== lexer.value) {
          throw new ConverterError('Unmatched XML tags.');
        }
        lexeme += lexer.whitespace;
        lexeme += lexer.lexeme;
        contextStack.pop();
        if (contextStack.length === 0) {
          lexer.whitespace = whitespace; // whitespace before end-of-line comment
          lexer.lexeme = lexeme; // end-of-line comment
          return;
        }
        break;
      case XML_EMPTY_ELEMENT_TAG:
        lexeme += lexer.whitespace;
        lexeme += lexer.lexeme;
        break;
      case XML_COMMENT:
        lexeme += lexer.whitespace;
        lexeme += lexer.lexeme;
        break;
      case EOF:
        throw new ConverterError('Unexpected end-of-file.');
      default:
        throw new CannotHappen('abstractReadEndOfLineComment');
    }
  }
}

function isXMLLexeme(lexeme) {
  return lexeme === ABSTRACT_XML;
}

function isEVLLexeme(lexeme) {
  return lexeme === ABSTRACT_EVL || lexeme === ABSTRACT_EOL_COMMENT;
}

function convertXML(previousLexeme, whitespace, lexeme) {
  let xml = '';
  if (isXMLLexeme(previousLexeme) && isEVLLexeme(lexeme)) {
    xml += whitespace;
    xml += '<toplevelcode><blockcode>';
  } else if (isEVLLexeme(previousLexeme) && isEVLLexeme(lexeme)) {
    if (countNewlines(whitespace) >= 2) {
      xml += '</blockcode></toplevelcode>';
      xml += whitespace;
      xml += '<toplevelcode><blockcode>';
    } else {
      xml += whitespace;
    }
  } else if (isEVLLexeme(previousLexeme) && isXMLLexeme(lexeme)) {
    xml += '</blockcode></toplevelcode>';
    xml += whitespace;
  } else {
    xml += whitespace;
  }
  return xml;
}

function countNewlines(string) {
  let count = 0;
  for (const char of string) {
    if (char === '\n') {
      count++;
    }
  }
  return count;
}

function convertEVL(previousLexeme, whitespace, lexeme) {
  let xml = '';
  if (isEVLLexeme(previousLexeme) && isXMLLexeme(lexeme)) {
    xml += '</blockcode><indentation style="margin-left: ';
    xml += countSpacesAfterFirstNewline(whitespace);
    xml += 'ch;"><blockcomment>';
    xml += whitespace;
  } else if (isXMLLexeme(previousLexeme) && isEVLLexeme(lexeme)) {
    xml += '</blockcomment></indentation><blockcode>';
    xml += whitespace;
  } else {
    xml += whitespace;
  }
  return xml;
}

function countSpacesAfterFirstNewline(string) {
  let newline = false;
  let count = 0;
  for (const char of string) {
    if (!newline) {
      if (char === '\n') {
        newline = true;
      }
    } else {
      if (char === ' ') {
        count++;
      } else {
        break;
      }
    }
  }
  return count;
}

/*******************/
/* Syntax Analyzer */
/*******************/

function syntaxAnalyzerError(formName) {
  throw new SyntaxAnalyzerError(`Malformed ${formName} form.`);
}

function checkCons(object, formName) {
  if (object instanceof EVLCons) {
    return object;
  } else {
    syntaxAnalyzerError(formName);
  }
}

function checkEmptyList(object, formName) {
  if (object instanceof EVLEmptyList) {
    return object;
  } else {
    syntaxAnalyzerError(formName);
  }
}

function checkProperList(object, formName) {
  let list = object;
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      list = list.cdr;
    } else {
      syntaxAnalyzerError(formName);
    }
  }
  return object;
}

function checkParameterList(object, formName) {
  if (object instanceof EVLVariable) {
    return [[object], true];
  } else {
    const variables = [];
    let variadic = false;
    let list = object
    while (list !== EVLEmptyList.NIL) {
      if (list instanceof EVLCons) {
        if (list.car instanceof EVLVariable) {
          variables.push(list.car);
        } else {
          syntaxAnalyzerError(formName);
        }
        if (list.cdr instanceof EVLVariable) {
          variables.push(list.cdr);
          variadic = true;
          break;
        } else {
          list = list.cdr;
        }
      } else {
        syntaxAnalyzerError(formName);
      }
    }
    if (new Set(variables).size !== variables.length) {
      syntaxAnalyzerError(formName);
    }
    return [variables, variadic];
  }
}

function checkVariable(object, formName) {
  if (object instanceof EVLVariable) {
    return object;
  } else {
    syntaxAnalyzerError(formName);
  }
}

function analyzeQuote(form) {
  let cons = form;
  cons = checkCons(cons.cdr, 'quote');
  const object = cons.car;
  checkEmptyList(cons.cdr, 'quote');
  return [object];
}

function analyzeProgn(form) {
  let cons = form;
  const forms = checkProperList(cons.cdr, 'progn');
  return [forms];
}

function analyzeIf(form) {
  let cons = form;
  cons = checkCons(cons.cdr, 'if');
  const testForm = cons.car;
  cons = checkCons(cons.cdr, 'if');
  const thenForm = cons.car;
  cons = checkCons(cons.cdr, 'if');
  const elseForm = cons.car;
  checkEmptyList(cons.cdr, 'if');
  return [testForm, thenForm, elseForm];
}

function analyzeLambda(form) {
  let cons = form;
  cons = checkCons(cons.cdr, '_lambda');
  const [variables, variadic] = checkParameterList(cons.car, '_lambda');
  const forms = checkProperList(cons.cdr, '_lambda');
  return [variables, variadic, forms];
}

function analyzeRef(form) {
  let cons = form;
  cons = checkCons(cons.cdr, 'ref');
  const variable = checkVariable(cons.car, 'ref');
  checkEmptyList(cons.cdr, 'ref');
  return [variable];
}

function analyzeSet(form) {
  let cons = form;
  cons = checkCons(cons.cdr, 'set');
  const variable = checkVariable(cons.car, 'set');
  cons = checkCons(cons.cdr, 'set');
  const valueForm = cons.car;
  checkEmptyList(cons.cdr, 'set');
  return [variable, valueForm];
}

function analyzeForEach(form) {
  let cons = form;
  cons = checkCons(cons.cdr, '_for-each');
  const functionForm = cons.car;
  cons = checkCons(cons.cdr, '_for-each');
  const listForm = cons.car;
  checkEmptyList(cons.cdr, '_for-each');
  return [functionForm, listForm];
}


function analyzeCatchErrors(form) {
  let cons = form;
  cons = checkCons(cons.cdr, '_catch-errors');
  const tryForm = cons.car;
  checkEmptyList(cons.cdr, '_catch-errors');
  return [tryForm];
}

function analyzeApplication(mv, apply, form) {
  let cons = form;
  if (mv || apply) {
    cons = checkCons(cons.cdr, 'application');
  }
  const operator = cons.car;
  const operands = checkProperList(cons.cdr, 'application');
  return [operator, operands];
}

/**********/
/* Scopes */
/**********/

const LEX_SCOPE = 0; // lexical scope
const DYN_SCOPE = 1; // dynamic scope

/**************/
/* Namespaces */
/**************/

const VAL_NS = 0; // value namespace
const FUN_NS = 1; // function namespace

/**********************/
/* Global Environment */
/**********************/

class UnboundVariable extends EvaluatorError {
  constructor(variable, namespace) {
    super(`The variable '${variable.name}' is unbound in the ${namespace} namespace.`);
    this.name = 'UnboundVariable';
  }
}

class GlobalEnv {
  static ref(namespace, variable) {
    switch (namespace) {
      case VAL_NS: {
        const value = variable.value;
        if (value !== null) {
          return value;
        } else {
          throw new UnboundVariable(variable, 'VALUE');
        }
      }
      case FUN_NS: {
        const value = variable.function;
        if (value !== null) {
          return value;
        } else {
          throw new UnboundVariable(variable, 'FUNCTION');
        }
      }
      default:
        throw new CannotHappen('GlobalEnv.ref');
    }
  }
  static set(namespace, variable, value) {
    switch (namespace) {
      case VAL_NS:
        return variable.value = value;
      case FUN_NS:
        return variable.function = value;
      default:
        throw new CannotHappen('GlobalEnv.set');
    }
  }
  // ref variant used by the preprocessor
  static preprocessorRef(namespace, variable) {
    switch (namespace) {
      case VAL_NS: {
        const value = variable.value;
        return [null, null, value];
      }
      case FUN_NS: {
        const value = variable.function;
        return [null, null, value];
      }
      default:
        throw new CannotHappen('GlobalEnv.preprocessorRef');
    }
  }
}

/*********************/
/* Local Environment */
/*********************/

class LocalEnv { // abstract class
}

class NullLocalEnv extends LocalEnv {
  constructor() {
    super();
  }
  ref(namespace, variable) {
    return GlobalEnv.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    return GlobalEnv.set(namespace, variable, value);
  }
  // ref variant used by the preprocessor
  preprocessorRef(namespace, variable, i) {
    return GlobalEnv.preprocessorRef(namespace, variable);
  }
}

const nullLocalEnv = new NullLocalEnv();

class Frame extends LocalEnv {
  constructor(namespace, variables, values, next) {
    super();
    this.namespace = namespace;
    this.variables = variables;
    this.values = values;
    this.next = next;
  }
  ref(namespace, variable) {
    if (this.namespace === namespace) {
      for (let j = 0; j < this.variables.length; j++) {
        if (this.variables[j] === variable) {
          return this.values[j];
        }
      }
    }
    return this.next?.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    if (this.namespace === namespace) {
      for (let j = 0; j < this.variables.length; j++) {
        if (this.variables[j] === variable) {
          return this.values[j] = value;
        }
      }
    }
    return this.next?.set(namespace, variable, value);
  }
  // ref variant used by the preprocessor
  preprocessorRef(namespace, variable, i) {
    if (this.namespace === namespace) {
      for (let j = 0; j < this.variables.length; j++) {
        if (this.variables[j] === variable) {
          return [i, j, this.values[j]];
        }
      }
    }
    return this.next.preprocessorRef(namespace, variable, i + 1);
  }
}

/**********************************/
/* Mapping Arguments to Variables */
/**********************************/

class TooFewArguments extends EvaluatorError {
  constructor() {
    super('Too few arguments.');
    this.name = 'TooFewArguments';
  }
}

class TooManyArguments extends EvaluatorError {
  constructor() {
    super('Too many arguments.');
    this.name = 'TooManyArguments';
  }
}

class MalformedSpreadableArgumentList extends EvaluatorError {
  constructor() {
    super('Malformed spreadable argument list.');
    this.name = 'MalformedSpreadableArgumentList';
  }
}

function mapPrimFunArgs(apply, args, arityMin, arityMax) {
  if (!apply) {
    const nargs = args.length;
    if (nargs < arityMin) {
      throw new TooFewArguments();
    }
    if (arityMax !== null && nargs > arityMax) {
      throw new TooManyArguments();
    }
    return args;
  } else {
    const nargs = args.length;
    const spreadArgs = [];
    let i = 0;
    while (i < nargs - 1) {
      if (arityMax === null || i < arityMax) {
        spreadArgs.push(args[i]);
        i++;
      } else {
        throw new TooManyArguments();
      }
    }
    if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
      throw new MalformedSpreadableArgumentList();
    }
    let argList = args[nargs - 1];
    while (argList !== EVLEmptyList.NIL) {
      if (argList instanceof EVLCons) {
        if (arityMax === null || i < arityMax) {
          spreadArgs.push(argList.car);
          i++;
        } else {
          throw new TooManyArguments();
        }
        argList = argList.cdr;
      } else {
        throw new MalformedSpreadableArgumentList();
      }
    }
    if (i < arityMin) {
      throw new TooFewArguments();
    }
    return spreadArgs;
  }
}

function mapClosureArgs(apply, args, vars, variadic) {
  if (!apply) {
    if (!variadic) {
      return mapClosureArgsForFixedArityCall(args, vars);
    } else {
      return mapClosureArgsForVariableArityCall(args, vars);
    }
  } else {
    if (!variadic) {
      return mapClosureArgsForFixedArityApply(args, vars);
    } else {
      return mapClosureArgsForVariableArityApply(args, vars);
    }
  }
}

function mapClosureArgsForFixedArityCall(args, vars) {
  const nargs = args.length;
  const nvars = vars.length;
  if (nargs < nvars) {
    throw new TooFewArguments();
  }
  if (nargs > nvars) {
    throw new TooManyArguments();
  }
  return args;
}

function mapClosureArgsForVariableArityCall(args, vars) {
  const nargs = args.length;
  const nvars = vars.length;
  const values = new Array(nvars);
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  let i = 0;
  while (i < nargs) {
    if (i < nvars - 1) {
      values[i] = args[i];
      i++;
    } else {
      const newCons = new EVLCons(args[i], EVLEmptyList.NIL);
      if (lastCons === null) {
        list = newCons;
      } else {
        lastCons.cdr = newCons;
      }
      lastCons = newCons;
      i++;
    }
  }
  if (i < nvars - 1) {
    throw new TooFewArguments();
  }
  values[nvars - 1] = list;
  return values;
}

function mapClosureArgsForFixedArityApply(args, vars) {
  const nargs = args.length;
  const nvars = vars.length;
  const values = new Array(nvars);
  let i = 0;
  while (i < nargs - 1) {
    if (i < nvars) {
      values[i] = args[i];
      i++;
    } else {
      throw new TooManyArguments();
    }
  }
  if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
    throw new MalformedSpreadableArgumentList();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (i < nvars) {
        values[i] = argList.car;
        i++;
      } else {
        throw new TooManyArguments();
      }
      argList = argList.cdr;
    } else {
      throw new MalformedSpreadableArgumentList();
    }
  }
  if (i < nvars) {
    throw new TooFewArguments();
  }
  return values;
}

function mapClosureArgsForVariableArityApply(args, vars) {
  const nargs = args.length;
  const nvars = vars.length;
  const values = new Array(nvars);
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  let i = 0;
  while (i < nargs - 1) {
    if (i < nvars - 1) {
      values[i] = args[i];
      i++;
    } else {
      const newCons = new EVLCons(args[i], EVLEmptyList.NIL);
      if (lastCons === null) {
        list = newCons;
      } else {
        lastCons.cdr = newCons;
      }
      lastCons = newCons;
      i++;
    }
  }
  if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
    throw new MalformedSpreadableArgumentList();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (i < nvars - 1) {
        values[i] = argList.car;
        i++;
      } else {
        if (lastCons === null) {
          list = argList;
        } else {
          lastCons.cdr = argList;
        }
        break;
      }
      argList = argList.cdr;
    } else {
      throw new MalformedSpreadableArgumentList();
    }
  }
  if (i < nvars - 1) {
    throw new TooFewArguments();
  }
  values[nvars - 1] = list;
  return values;
}

function listToArray(list) {
  const array = [];
  while (list !== EVLEmptyList.NIL) {
    array.push(list.car);
    list = list.cdr;
  }
  return array;
}

/*********************/
/* Generic Evaluator */
/*********************/

function genericEval(form) {
  switch(selectedEvaluator) {
    case 'plainrec':
      return plainrecEval(form);
    case 'cps':
      return cpsEval(form);
    case 'oocps':
      return oocpsEval(form);
    case 'sboocps':
      return sboocpsEval(form);
    case 'trampoline':
      return trampolineEval(form);
    case 'trampolinepp':
      return trampolineppEval(form);
    default:
      throw new CannotHappen('genericEval');
  }
}

function emptyListError() {
  throw new EvaluatorError('The empty list is not a form.');
}

function ifTestFormError() {
  throw new EvaluatorError('The test form does not evaluate to a boolean.');
}

function forEachNotImplemented() {
  throw new EvaluatorError('_for-each is not implemented.');
}

function forEachFunctionFormError() {
  throw new EvaluatorError('The function form does not evaluate to a function.');
}

function forEachListFormError() {
  throw new EvaluatorError('The list form does not evaluate to a proper list.');
}

function applicationOperatorFormError() {
  throw new EvaluatorError('The operator form does not evaluate to a function.');
}

/*****************************/
/* Plain Recursive Evaluator */
/*****************************/

function plainrecEval(form) {
  return plainrecEvalForm(form, nullLocalEnv, nullLocalEnv);
}

function plainrecEvalForm(form, lenv, denv) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return plainrecEvalQuote(form, lenv, denv);
      case prognVariable:
        return plainrecEvalProgn(form, lenv, denv);
      case ifVariable:
        return plainrecEvalIf(form, lenv, denv);
      case _vlambdaVariable:
        return plainrecEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, denv);
      case _mlambdaVariable:
        return plainrecEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, denv);
      case _flambdaVariable:
        return plainrecEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, denv);
      case _dlambdaVariable:
        return plainrecEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, denv);
      case vrefVariable:
        return plainrecEvalRef(LEX_SCOPE, VAL_NS, form, lenv, denv);
      case vsetVariable:
        return plainrecEvalSet(LEX_SCOPE, VAL_NS, form, lenv, denv);
      case frefVariable:
        return plainrecEvalRef(LEX_SCOPE, FUN_NS, form, lenv, denv);
      case fsetVariable:
        return plainrecEvalSet(LEX_SCOPE, FUN_NS, form, lenv, denv);
      case drefVariable:
        return plainrecEvalRef(DYN_SCOPE, VAL_NS, form, lenv, denv);
      case dsetVariable:
        return plainrecEvalSet(DYN_SCOPE, VAL_NS, form, lenv, denv);
      case _forEachVariable:
        forEachNotImplemented();
      case _catchErrorsVariable:
        return plainrecEvalCatchErrors(form, lenv, denv);
      case applyVariable:
        return plainrecEvalApplication(false, true, form, lenv, denv);
      case multipleValueCallVariable:
        return plainrecEvalApplication(true, false, form, lenv, denv);
      case multipleValueApplyVariable:
        return plainrecEvalApplication(true, true, form, lenv, denv);
      default:
        return plainrecEvalApplication(false, false, form, lenv, denv);
    }
  } else if (form instanceof EVLVariable) {
    return lenv.ref(VAL_NS, form);
  } else {
    return form;
  }
}

function plainrecEvalQuote(form, lenv, denv) {
  const [object] = analyzeQuote(form);
  return object;
}

function plainrecEvalProgn(form, lenv, denv) {
  const [forms] = analyzeProgn(form);
  return plainrecEvalForms(forms, lenv, denv);
}

function plainrecEvalForms(forms, lenv, denv) {
  if (forms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return plainrecEvalForm(forms.car, lenv, denv);
  } else {
    plainrecEvalForm(forms.car, lenv, denv);
    return plainrecEvalForms(forms.cdr, lenv, denv);
  }
}

function plainrecEvalIf(form, lenv, denv) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  const test = plainrecEvalForm(testForm, lenv, denv).primaryValue();
  switch (test) {
    case EVLBoolean.TRUE:
      return plainrecEvalForm(thenForm, lenv, denv);
    case EVLBoolean.FALSE:
      return plainrecEvalForm(elseForm, lenv, denv);
    default:
      ifTestFormError();
  }
}

function plainrecEvalLambda(scope, namespace, macro, form, lenv, denv) {
  const [variables, variadic, forms] = analyzeLambda(form);
  return new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv);
}

function plainrecEvalRef(scope, namespace, form, lenv, denv) {
  const [variable] = analyzeRef(form);
  switch (scope) {
    case LEX_SCOPE:
      return lenv.ref(namespace, variable);
    case DYN_SCOPE:
      return denv.ref(namespace, variable);
    default:
      throw new CannotHappen('plainrecEvalRef');
  }
}

function plainrecEvalSet(scope, namespace, form, lenv, denv) {
  const [variable, valueForm] = analyzeSet(form);
  const value = plainrecEvalForm(valueForm, lenv, denv).primaryValue();
  switch (scope) {
    case LEX_SCOPE:
      return lenv.set(namespace, variable, value);
    case DYN_SCOPE:
      return denv.set(namespace, variable, value);
    default:
      throw new CannotHappen('plainrecEvalSet');
  }
}

function plainrecEvalCatchErrors(form, lenv, denv) {
  const [tryForm] = analyzeCatchErrors(form);
  try {
    plainrecEvalForm(tryForm, lenv, denv);
  } catch (exception) {
    return new EVLString(exception.name);
  }
  return EVLVoid.VOID;
}

function plainrecEvalApplication(mv, apply, form, lenv, denv) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  const fn = plainrecEvalOperator(operator, lenv, denv).primaryValue();
  const macro = operator instanceof EVLVariable && fn instanceof EVLClosure && fn.macro;
  const args = plainrecEvalOperands(mv, macro, operands, [], lenv, denv);
  return plainrecInvokeFun(apply, macro, fn, args, lenv, denv);
}

function plainrecEvalOperator(operator, lenv, denv) {
  if (operator instanceof EVLVariable) {
    return lenv.ref(FUN_NS, operator);
  } else {
    return plainrecEvalForm(operator, lenv, denv);
  }
}

function plainrecEvalOperands(mv, macro, operands, args, lenv, denv) {
  if (operands === EVLEmptyList.NIL) {
    return args;
  } else {
    if (macro) {
      args.push(operands.car);
      return plainrecEvalOperands(mv, macro, operands.cdr, args, lenv, denv);
    } else {
      const result = plainrecEvalForm(operands.car, lenv, denv);
      if (mv) {
        result.allValues().forEach(value => args.push(value));
      } else {
        args.push(result.primaryValue());
      }
      return plainrecEvalOperands(mv, macro, operands.cdr, args, lenv, denv);
    }
  }
}

function plainrecInvokeFun(apply, macro, fn, args, lenv, denv) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        if (macro) {
          const expansion = plainrecEvalForms(fn.forms, elenv, denv).primaryValue();
          return plainrecEvalForm(expansion, lenv, denv);
        } else {
          return plainrecEvalForms(fn.forms, elenv, denv);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.variables, values, denv);
        return plainrecEvalForms(fn.forms, fn.lenv, edenv);
      default:
        throw new CannotHappen('plainrecInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

/****************************************/
/* Continuation Passing Style Evaluator */
/****************************************/

function cpsEval(form) {
  return cpsEvalForm(form, nullLocalEnv, nullLocalEnv, cpsEndCont);
}

function cpsEvalForm(form, lenv, denv, k) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return cpsEvalQuote(form, lenv, denv, k);
      case prognVariable:
        return cpsEvalProgn(form, lenv, denv, k);
      case ifVariable:
        return cpsEvalIf(form, lenv, denv, k);
      case _vlambdaVariable:
        return cpsEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, denv, k);
      case _mlambdaVariable:
        return cpsEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, denv, k);
      case _flambdaVariable:
        return cpsEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, denv, k);
      case _dlambdaVariable:
        return cpsEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, denv, k);
      case vrefVariable:
        return cpsEvalRef(LEX_SCOPE, VAL_NS, form, lenv, denv, k);
      case vsetVariable:
        return cpsEvalSet(LEX_SCOPE, VAL_NS, form, lenv, denv, k);
      case frefVariable:
        return cpsEvalRef(LEX_SCOPE, FUN_NS, form, lenv, denv, k);
      case fsetVariable:
        return cpsEvalSet(LEX_SCOPE, FUN_NS, form, lenv, denv, k);
      case drefVariable:
        return cpsEvalRef(DYN_SCOPE, VAL_NS, form, lenv, denv, k);
      case dsetVariable:
        return cpsEvalSet(DYN_SCOPE, VAL_NS, form, lenv, denv, k);
      case _forEachVariable:
        return cpsEvalForEach(form, lenv, denv, k);
      case _catchErrorsVariable:
        return cpsEvalCatchErrors(form, lenv, denv, k);
      case applyVariable:
        return cpsEvalApplication(false, true, form, lenv, denv, k);
      case multipleValueCallVariable:
        return cpsEvalApplication(true, false, form, lenv, denv, k);
      case multipleValueApplyVariable:
        return cpsEvalApplication(true, true, form, lenv, denv, k);
      default:
        return cpsEvalApplication(false, false, form, lenv, denv, k);
    }
  } else if (form instanceof EVLVariable) {
    return k(lenv.ref(VAL_NS, form));
  } else {
    return k(form);
  }
}

const cpsEndCont = result => result;

function cpsEvalQuote(form, lenv, denv, k) {
  const [object] = analyzeQuote(form);
  return k(object);
}

function cpsEvalProgn(form, lenv, denv, k) {
  const [forms] = analyzeProgn(form);
  return cpsEvalForms(forms, lenv, denv, k);
}

function cpsEvalForms(forms, lenv, denv, k) {
  if (forms === EVLEmptyList.NIL) {
    return k(EVLVoid.VOID);
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return cpsEvalForm(forms.car, lenv, denv, k);
  } else {
    return cpsEvalForm(
      forms.car, lenv, denv,
      result => { // ButLastFormCont
        return cpsEvalForms(forms.cdr, lenv, denv, k);
      }
    );
  }
}

function cpsEvalIf(form, lenv, denv, k) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  return cpsEvalForm(
    testForm, lenv, denv,
    result => { // IfTestFormCont
      const test = result.primaryValue();
      switch (test) {
        case EVLBoolean.TRUE:
          return cpsEvalForm(thenForm, lenv, denv, k);
        case EVLBoolean.FALSE:
          return cpsEvalForm(elseForm, lenv, denv, k);
        default:
          ifTestFormError();
      }
    }
  );
}

function cpsEvalLambda(scope, namespace, macro, form, lenv, denv, k) {
  const [variables, variadic, forms] = analyzeLambda(form);
  return k(new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv));
}

function cpsEvalRef(scope, namespace, form, lenv, denv, k) {
  const [variable] = analyzeRef(form);
  switch (scope) {
    case LEX_SCOPE:
      return k(lenv.ref(namespace, variable));
    case DYN_SCOPE:
      return k(denv.ref(namespace, variable));
    default:
      throw new CannotHappen('cpsEvalRef');
  }
}

function cpsEvalSet(scope, namespace, form, lenv, denv, k) {
  const [variable, valueForm] = analyzeSet(form);
  return cpsEvalForm(
    valueForm, lenv, denv,
    result => { // SetValueFormCont
      const value = result.primaryValue()
      switch (scope) {
        case LEX_SCOPE:
          return k(lenv.set(namespace, variable, value));
        case DYN_SCOPE:
          return k(denv.set(namespace, variable, value));
        default:
          throw new CannotHappen('cpsEvalSet');
      }
    }
  );
}

function cpsEvalForEach(form, lenv, denv, k) {
  const [functionForm, listForm] = analyzeForEach(form);
  return cpsEvalForm(
    functionForm, lenv, denv,
    result => { // ForEachFunctionFormCont
      const fn = result.primaryValue();
      if (!(fn instanceof EVLFunction)) {
        forEachFunctionFormError();
      }
      return cpsEvalForm(
        listForm, lenv, denv,
        result => { // ForEachListFormCont
          let list = result.primaryValue();
          while (list !== EVLEmptyList.NIL) {
            if (list instanceof EVLCons) {
              cpsInvokeFun(false, false, fn, [list.car], lenv, denv, cpsEndCont);
              list = list.cdr;
            } else {
              forEachListFormError();
            }
          }
          return k(EVLVoid.VOID);
        }
      );
    }
  );
}

function cpsEvalCatchErrors(form, lenv, denv, k) {
  const [tryForm] = analyzeCatchErrors(form);
  try {
    cpsEvalForm(tryForm, lenv, denv, cpsEndCont);
  } catch (exception) {
    return k(new EVLString(exception.name));
  }
  return k(EVLVoid.VOID);
}

function cpsEvalApplication(mv, apply, form, lenv, denv, k) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  return cpsEvalOperator(
    operator, lenv, denv,
    result => { // OperatorCont
      const fn = result.primaryValue();
      const macro = operator instanceof EVLVariable && fn instanceof EVLClosure && fn.macro;
      return cpsEvalOperands(
        mv, macro, operands, [], lenv, denv,
        args => { // OperandsCont
          return cpsInvokeFun(apply, macro, fn, args, lenv, denv, k);
        }
      );
    }
  );
}

function cpsEvalOperator(operator, lenv, denv, k) {
  if (operator instanceof EVLVariable) {
    return k(lenv.ref(FUN_NS, operator));
  } else {
    return cpsEvalForm(operator, lenv, denv, k);
  }
}

function cpsEvalOperands(mv, macro, operands, args, lenv, denv, k) {
  if (operands === EVLEmptyList.NIL) {
    return k(args);
  } else {
    if (macro) {
      args.push(operands.car);
      return cpsEvalOperands(mv, macro, operands.cdr, args, lenv, denv, k);
    } else {
      return cpsEvalForm(
        operands.car, lenv, denv,
        result => { // OperandCont
          if (mv) {
            result.allValues().forEach(value => args.push(value));
          } else {
            args.push(result.primaryValue());
          }
          return cpsEvalOperands(mv, macro, operands.cdr, args, lenv, denv, k);
        }
      );
    }
  }
}

function cpsInvokeFun(apply, macro, fn, args, lenv, denv, k) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return k(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        if (macro) {
          const expansion = cpsEvalForms(fn.forms, elenv, denv, cpsEndCont).primaryValue();
          return cpsEvalForm(expansion, lenv, denv, k);
        } else {
          return cpsEvalForms(fn.forms, elenv, denv, k);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.variables, values, denv);
        return cpsEvalForms(fn.forms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('cpsInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

/*********************************/
/* Object-Oriented CPS Evaluator */
/*********************************/

function oocpsEval(form) {
  return oocpsEvalForm(form, nullLocalEnv, nullLocalEnv, oocpsEndCont);
}

function oocpsEvalForm(form, lenv, denv, k) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return oocpsEvalQuote(form, lenv, denv, k);
      case prognVariable:
        return oocpsEvalProgn(form, lenv, denv, k);
      case ifVariable:
        return oocpsEvalIf(form, lenv, denv, k);
      case _vlambdaVariable:
        return oocpsEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, denv, k);
      case _mlambdaVariable:
        return oocpsEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, denv, k);
      case _flambdaVariable:
        return oocpsEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, denv, k);
      case _dlambdaVariable:
        return oocpsEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, denv, k);
      case vrefVariable:
        return oocpsEvalRef(LEX_SCOPE, VAL_NS, form, lenv, denv, k);
      case vsetVariable:
        return oocpsEvalSet(LEX_SCOPE, VAL_NS, form, lenv, denv, k);
      case frefVariable:
        return oocpsEvalRef(LEX_SCOPE, FUN_NS, form, lenv, denv, k);
      case fsetVariable:
        return oocpsEvalSet(LEX_SCOPE, FUN_NS, form, lenv, denv, k);
      case drefVariable:
        return oocpsEvalRef(DYN_SCOPE, VAL_NS, form, lenv, denv, k);
      case dsetVariable:
        return oocpsEvalSet(DYN_SCOPE, VAL_NS, form, lenv, denv, k);
      case _forEachVariable:
        return oocpsEvalForEach(form, lenv, denv, k);
      case _catchErrorsVariable:
        return oocpsEvalCatchErrors(form, lenv, denv, k);
      case applyVariable:
        return oocpsEvalApplication(false, true, form, lenv, denv, k);
      case multipleValueCallVariable:
        return oocpsEvalApplication(true, false, form, lenv, denv, k);
      case multipleValueApplyVariable:
        return oocpsEvalApplication(true, true, form, lenv, denv, k);
      default:
        return oocpsEvalApplication(false, false, form, lenv, denv, k);
    }
  } else if (form instanceof EVLVariable) {
    return k.invoke(lenv.ref(VAL_NS, form));
  } else {
    return k.invoke(form);
  }
}

class OOCPSCont { // abstract class
  constructor(lenv, denv, k) {
    this.lenv = lenv;
    this.denv = denv;
    this.k = k;
  }
}

class OOCPSEndCont extends OOCPSCont {
  constructor() {
    super(null, null, null);
  }
  invoke(result) {
    return result;
  }
}

const oocpsEndCont = new OOCPSEndCont();

function oocpsEvalQuote(form, lenv, denv, k) {
  const [object] = analyzeQuote(form);
  return k.invoke(object);
}

function oocpsEvalProgn(form, lenv, denv, k) {
  const [forms] = analyzeProgn(form);
  return oocpsEvalForms(forms, lenv, denv, k);
}

function oocpsEvalForms(forms, lenv, denv, k) {
  if (forms === EVLEmptyList.NIL) {
    return k.invoke(EVLVoid.VOID);
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return oocpsEvalForm(forms.car, lenv, denv, k);
  } else {
    return oocpsEvalForm(
      forms.car, lenv, denv,
      new OOCPSButLastFormCont(forms, lenv, denv, k)
    );
  }
}

class OOCPSButLastFormCont extends OOCPSCont {
  constructor(forms, lenv, denv, k) {
    super(lenv, denv, k);
    this.forms = forms;
  }
  invoke(result) {
    const {forms, lenv, denv, k} = this;
    return oocpsEvalForms(forms.cdr, lenv, denv, k);
  }
}

function oocpsEvalIf(form, lenv, denv, k) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  return oocpsEvalForm(
    testForm, lenv, denv,
    new OOCPSIfTestFormCont(thenForm, elseForm, lenv, denv, k)
  );
}

class OOCPSIfTestFormCont extends OOCPSCont {
  constructor(thenForm, elseForm, lenv, denv, k) {
    super(lenv, denv, k);
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  invoke(result) {
    const {thenForm, elseForm, lenv, denv, k} = this;
    const test = result.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return oocpsEvalForm(thenForm, lenv, denv, k);
      case EVLBoolean.FALSE:
        return oocpsEvalForm(elseForm, lenv, denv, k);
      default:
        ifTestFormError();
    }
  }
}

function oocpsEvalLambda(scope, namespace, macro, form, lenv, denv, k) {
  const [variables, variadic, forms] = analyzeLambda(form);
  return k.invoke(new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv));
}

function oocpsEvalRef(scope, namespace, form, lenv, denv, k) {
  const [variable] = analyzeRef(form);
  switch (scope) {
    case LEX_SCOPE:
      return k.invoke(lenv.ref(namespace, variable));
    case DYN_SCOPE:
      return k.invoke(denv.ref(namespace, variable));
    default:
      throw new CannotHappen('oocpsEvalRef');
  }
}

function oocpsEvalSet(scope, namespace, form, lenv, denv, k) {
  const [variable, valueForm] = analyzeSet(form);
  return oocpsEvalForm(
    valueForm, lenv, denv,
    new OOCPSSetValueFormCont(scope, namespace, variable, lenv, denv, k)
  );
}

class OOCPSSetValueFormCont extends OOCPSCont {
  constructor(scope, namespace, variable, lenv, denv, k) {
    super(lenv, denv, k);
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {scope, namespace, variable, lenv, denv, k} = this;
    const value = result.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return k.invoke(lenv.set(namespace, variable, value));
      case DYN_SCOPE:
        return k.invoke(denv.set(namespace, variable, value));
      default:
        throw new CannotHappen('OOCPSSetValueFormCont.invoke');
    }
  }
}

function oocpsEvalForEach(form, lenv, denv, k) {
  const [functionForm, listForm] = analyzeForEach(form);
  return oocpsEvalForm(
    functionForm, lenv, denv,
    new OOCPSForEachFunctionFormCont(listForm, lenv, denv, k)
  );
}

class OOCPSForEachFunctionFormCont extends OOCPSCont {
  constructor(listForm, lenv, denv, k) {
    super(lenv, denv, k);
    this.listForm = listForm;
  }
  invoke(result) {
    const {listForm, lenv, denv, k} = this;
    const fn = result.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      forEachFunctionFormError();
    }
    return oocpsEvalForm(
      listForm, lenv, denv,
      new OOCPSForEachListFormCont(fn, lenv, denv, k)
    );
  }
}

class OOCPSForEachListFormCont extends OOCPSCont {
  constructor(fn, lenv, denv, k) {
    super(lenv, denv, k);
    this.fn = fn;
  }
  invoke(result) {
    const {fn, lenv, denv, k} = this;
    let list = result.primaryValue();
    while (list !== EVLEmptyList.NIL) {
      if (list instanceof EVLCons) {
        oocpsInvokeFun(false, false, fn, [list.car], lenv, denv, oocpsEndCont);
        list = list.cdr;
      } else {
        forEachListFormError();
      }
    }
    return k.invoke(EVLVoid.VOID);
  }
}

function oocpsEvalCatchErrors(form, lenv, denv, k) {
  const [tryForm] = analyzeCatchErrors(form);
  try {
    oocpsEvalForm(tryForm, lenv, denv, oocpsEndCont);
  } catch (exception) {
    return k.invoke(new EVLString(exception.name));
  }
  return k.invoke(EVLVoid.VOID);
}

function oocpsEvalApplication(mv, apply, form, lenv, denv, k) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  return oocpsEvalOperator(
    operator, lenv, denv,
    new OOCPSOperatorCont(mv, apply, operator, operands, lenv, denv, k)
  );
}

function oocpsEvalOperator(operator, lenv, denv, k) {
  if (operator instanceof EVLVariable) {
    return k.invoke(lenv.ref(FUN_NS, operator));
  } else {
    return oocpsEvalForm(operator, lenv, denv, k);
  }
}

class OOCPSOperatorCont extends OOCPSCont {
  constructor(mv, apply, operator, operands, lenv, denv, k) {
    super(lenv, denv, k);
    this.mv = mv;
    this.apply = apply;
    this.operator = operator;
    this.operands = operands;
  }
  invoke(result) {
    const {mv, apply, operator, operands, lenv, denv, k} = this;
    const fn = result.primaryValue();
    const macro = operator instanceof EVLVariable && fn instanceof EVLClosure && fn.macro;
    return oocpsEvalOperands(
      mv, macro, operands, [], lenv, denv,
      new OOCPSOperandsCont(apply, macro, fn, lenv, denv, k)
    );
  }
}

function oocpsEvalOperands(mv, macro, operands, args, lenv, denv, k) {
  if (operands === EVLEmptyList.NIL) {
    return k.invoke(args);
  } else {
    if (macro) {
      args.push(operands.car);
      return oocpsEvalOperands(mv, macro, operands.cdr, args, lenv, denv, k);
    } else {
      return oocpsEvalForm(
        operands.car, lenv, denv,
        new OOCPSOperandCont(mv, macro, operands, args, lenv, denv, k)
      );
    }
  }
}

class OOCPSOperandCont extends OOCPSCont {
  constructor(mv, macro, operands, args, lenv, denv, k) {
    super(lenv, denv, k);
    this.mv = mv;
    this.macro = macro;
    this.operands = operands;
    this.args = args;
  }
  invoke(result) {
    const {mv, macro, operands, args, lenv, denv, k} = this;
    if (mv) {
      result.allValues().forEach(value => args.push(value));
    } else {
      args.push(result.primaryValue());
    }
    return oocpsEvalOperands(mv, macro, operands.cdr, args, lenv, denv, k);
  }
}

class OOCPSOperandsCont extends OOCPSCont {
  constructor(apply, macro, fn, lenv, denv, k) {
    super(lenv, denv, k);
    this.apply = apply;
    this.macro = macro;
    this.fn = fn;
  }
  invoke(args) {
    const {apply, macro, fn, lenv, denv, k} = this;
    return oocpsInvokeFun(apply, macro, fn, args, lenv, denv, k);
  }
}

function oocpsInvokeFun(apply, macro, fn, args, lenv, denv, k) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return k.invoke(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        if (macro) {
          const expansion = oocpsEvalForms(fn.forms, elenv, denv, oocpsEndCont).primaryValue();
          return oocpsEvalForm(expansion, lenv, denv, k);
        } else {
          return oocpsEvalForms(fn.forms, elenv, denv, k);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.variables, values, denv);
        return oocpsEvalForms(fn.forms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('oocpsInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

/*********************************************/
/* Stack-Based Object-Oriented CPS Evaluator */
/*********************************************/

function sboocpsEval(form) {
  const kStack = new SBOOCPSControlStack();
  kStack.push(sboocpsEndCont);
  return sboocpsEvalForm(form, nullLocalEnv, kStack);
}

class SBOOCPSControlStack {
  constructor() {
    this.stack = []; // element: SBOOCPSCont or Frame
  }
  push(element) {
    this.stack.push(element);
  }
  invokeCont(result) {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof SBOOCPSCont) {
        return element.invoke(result);
      }
    }
  }
  size() {
    return this.stack.length;
  }
  trim(size) {
    while (this.stack.length !== size) {
      this.stack.pop();
    }
  }
  ref(namespace, variable) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.ref(namespace, variable);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.set(namespace, variable, value);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.set(namespace, variable, value);
  }
}

function sboocpsEvalForm(form, lenv, kStack) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return sboocpsEvalQuote(form, lenv, kStack);
      case prognVariable:
        return sboocpsEvalProgn(form, lenv, kStack);
      case ifVariable:
        return sboocpsEvalIf(form, lenv, kStack);
      case _vlambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, kStack);
      case _mlambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, kStack);
      case _flambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, kStack);
      case _dlambdaVariable:
        return sboocpsEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, kStack);
      case vrefVariable:
        return sboocpsEvalRef(LEX_SCOPE, VAL_NS, form, lenv, kStack);
      case vsetVariable:
        return sboocpsEvalSet(LEX_SCOPE, VAL_NS, form, lenv, kStack);
      case frefVariable:
        return sboocpsEvalRef(LEX_SCOPE, FUN_NS, form, lenv, kStack);
      case fsetVariable:
        return sboocpsEvalSet(LEX_SCOPE, FUN_NS, form, lenv, kStack);
      case drefVariable:
        return sboocpsEvalRef(DYN_SCOPE, VAL_NS, form, lenv, kStack);
      case dsetVariable:
        return sboocpsEvalSet(DYN_SCOPE, VAL_NS, form, lenv, kStack);
      case _forEachVariable:
        return sboocpsEvalForEach(form, lenv, kStack);
      case _catchErrorsVariable:
        return sboocpsEvalCatchErrors(form, lenv, kStack);
      case applyVariable:
        return sboocpsEvalApplication(false, true, form, lenv, kStack);
      case multipleValueCallVariable:
        return sboocpsEvalApplication(true, false, form, lenv, kStack);
      case multipleValueApplyVariable:
        return sboocpsEvalApplication(true, true, form, lenv, kStack);
      default:
        return sboocpsEvalApplication(false, false, form, lenv, kStack);
    }
  } else if (form instanceof EVLVariable) {
    return kStack.invokeCont(lenv.ref(VAL_NS, form));
  } else {
    return kStack.invokeCont(form);
  }
}

class SBOOCPSCont { // abstract class
  constructor(lenv, kStack) {
    this.lenv = lenv;
    this.kStack = kStack;
  }
}

class SBOOCPSEndCont extends SBOOCPSCont {
  constructor() {
    super(null, null);
  }
  invoke(result) {
    return result;
  }
}

const sboocpsEndCont = new SBOOCPSEndCont();

function sboocpsEvalQuote(form, lenv, kStack) {
  const [object] = analyzeQuote(form);
  return kStack.invokeCont(object);
}

function sboocpsEvalProgn(form, lenv, kStack) {
  const [forms] = analyzeProgn(form);
  return sboocpsEvalForms(forms, lenv, kStack);
}

function sboocpsEvalForms(forms, lenv, kStack) {
  if (forms === EVLEmptyList.NIL) {
    return kStack.invokeCont(EVLVoid.VOID);
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return sboocpsEvalForm(forms.car, lenv, kStack);
  } else {
    kStack.push(new SBOOCPSButLastFormCont(forms, lenv, kStack));
    return sboocpsEvalForm(forms.car, lenv, kStack);
  }
}

class SBOOCPSButLastFormCont extends SBOOCPSCont {
  constructor(forms, lenv, kStack) {
    super(lenv, kStack);
    this.forms = forms;
  }
  invoke(result) {
    const {forms, lenv, kStack} = this;
    return sboocpsEvalForms(forms.cdr, lenv, kStack);
  }
}

function sboocpsEvalIf(form, lenv, kStack) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  kStack.push(new SBOOCPSIfTestFormCont(thenForm, elseForm, lenv, kStack));
  return sboocpsEvalForm(testForm, lenv, kStack);
}

class SBOOCPSIfTestFormCont extends SBOOCPSCont {
  constructor(thenForm, elseForm, lenv, kStack) {
    super(lenv, kStack);
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  invoke(result) {
    const {thenForm, elseForm, lenv, kStack} = this;
    const test = result.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return sboocpsEvalForm(thenForm, lenv, kStack);
      case EVLBoolean.FALSE:
        return sboocpsEvalForm(elseForm, lenv, kStack);
      default:
        ifTestFormError();
    }
  }
}

function sboocpsEvalLambda(scope, namespace, macro, form, lenv, kStack) {
  const [variables, variadic, forms] = analyzeLambda(form);
  return kStack.invokeCont(new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv));
}

function sboocpsEvalRef(scope, namespace, form, lenv, kStack) {
  const [variable] = analyzeRef(form);
  switch (scope) {
    case LEX_SCOPE:
      return kStack.invokeCont(lenv.ref(namespace, variable));
    case DYN_SCOPE:
      return kStack.invokeCont(kStack.ref(namespace, variable));
    default:
      throw new CannotHappen('sboocpsEvalRef');
  }
}

function sboocpsEvalSet(scope, namespace, form, lenv, kStack) {
  const [variable, valueForm] = analyzeSet(form);
  kStack.push(new SBOOCPSSetValueFormCont(scope, namespace, variable, lenv, kStack));
  return sboocpsEvalForm(valueForm, lenv, kStack);
}

class SBOOCPSSetValueFormCont extends SBOOCPSCont {
  constructor(scope, namespace, variable, lenv, kStack) {
    super(lenv, kStack);
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {scope, namespace, variable, lenv, kStack} = this;
    const value = result.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return kStack.invokeCont(lenv.set(namespace, variable, value));
      case DYN_SCOPE:
        return kStack.invokeCont(kStack.set(namespace, variable, value));
      default:
        throw new CannotHappen('SBOOCPSSetValueFormCont.invoke');
    }
  }
}

function sboocpsEvalForEach(form, lenv, kStack) {
  const [functionForm, listForm] = analyzeForEach(form);
  kStack.push(new SBOOCPSForEachFunctionFormCont(listForm, lenv, kStack));
  return sboocpsEvalForm(functionForm, lenv, kStack);
}

class SBOOCPSForEachFunctionFormCont extends SBOOCPSCont {
  constructor(listForm, lenv, kStack) {
    super(lenv, kStack);
    this.listForm = listForm;
  }
  invoke(result) {
    const {listForm, lenv, kStack} = this;
    const fn = result.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      forEachFunctionFormError();
    }
    kStack.push(new SBOOCPSForEachListFormCont(fn, lenv, kStack));
    return sboocpsEvalForm(listForm, lenv, kStack);
  }
}

class SBOOCPSForEachListFormCont extends SBOOCPSCont {
  constructor(fn, lenv, kStack) {
    super(lenv, kStack);
    this.fn = fn;
  }
  invoke(result) {
    const {fn, lenv, kStack} = this;
    let list = result.primaryValue();
    while (list !== EVLEmptyList.NIL) {
      if (list instanceof EVLCons) {
        kStack.push(sboocpsEndCont);
        sboocpsInvokeFun(false, false, fn, [list.car], lenv, kStack);
        list = list.cdr;
      } else {
        forEachListFormError();
      }
    }
    return kStack.invokeCont(EVLVoid.VOID);
  }
}

function sboocpsEvalCatchErrors(form, lenv, kStack) {
  const [tryForm] = analyzeCatchErrors(form);
  const kStackSize = kStack.size();
  try {
    kStack.push(sboocpsEndCont);
    sboocpsEvalForm(tryForm, lenv, kStack);
  } catch (exception) {
    kStack.trim(kStackSize);
    return kStack.invokeCont(new EVLString(exception.name));
  }
  return kStack.invokeCont(EVLVoid.VOID);
}

function sboocpsEvalApplication(mv, apply, form, lenv, kStack) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  kStack.push(new SBOOCPSOperatorCont(mv, apply, operator, operands, lenv, kStack));
  return sboocpsEvalOperator(operator, lenv, kStack);
}

function sboocpsEvalOperator(operator, lenv, kStack) {
  if (operator instanceof EVLVariable) {
    return kStack.invokeCont(lenv.ref(FUN_NS, operator));
  } else {
    return sboocpsEvalForm(operator, lenv, kStack);
  }
}

class SBOOCPSOperatorCont extends SBOOCPSCont {
  constructor(mv, apply, operator, operands, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.apply = apply;
    this.operator = operator;
    this.operands = operands;
  }
  invoke(result) {
    const {mv, apply, operator, operands, lenv, kStack} = this;
    const fn = result.primaryValue();
    const macro = operator instanceof EVLVariable && fn instanceof EVLClosure && fn.macro;
    kStack.push(new SBOOCPSOperandsCont(apply, macro, fn, lenv, kStack));
    return sboocpsEvalOperands(mv, macro, operands, [], lenv, kStack);
  }
}

function sboocpsEvalOperands(mv, macro, operands, args, lenv, kStack) {
  if (operands === EVLEmptyList.NIL) {
    return kStack.invokeCont(args);
  } else {
    if (macro) {
      args.push(operands.car);
      return sboocpsEvalOperands(mv, macro, operands.cdr, args, lenv, kStack);
    } else {
      kStack.push(new SBOOCPSOperandCont(mv, macro, operands, args, lenv, kStack));
      return sboocpsEvalForm(operands.car, lenv, kStack);
    }
  }
}

class SBOOCPSOperandCont extends SBOOCPSCont {
  constructor(mv, macro, operands, args, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.macro = macro;
    this.operands = operands;
    this.args = args;
  }
  invoke(result) {
    const {mv, macro, operands, args, lenv, kStack} = this;
    if (mv) {
      result.allValues().forEach(value => args.push(value));
    } else {
      args.push(result.primaryValue());
    }
    return sboocpsEvalOperands(mv, macro, operands.cdr, args, lenv, kStack);
  }
}

class SBOOCPSOperandsCont extends SBOOCPSCont {
  constructor(apply, macro, fn, lenv, kStack) {
    super(lenv, kStack);
    this.apply = apply;
    this.macro = macro;
    this.fn = fn;
  }
  invoke(args) {
    const {apply, macro, fn, lenv, kStack} = this;
    return sboocpsInvokeFun(apply, macro, fn, args, lenv, kStack);
  }
}

function sboocpsInvokeFun(apply, macro, fn, args, lenv, kStack) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return kStack.invokeCont(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        if (macro) {
          kStack.push(sboocpsEndCont);
          const expansion = sboocpsEvalForms(fn.forms, elenv, kStack).primaryValue();
          return sboocpsEvalForm(expansion, lenv, kStack);
        } else {
          return sboocpsEvalForms(fn.forms, elenv, kStack);
        }
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.variables, values, undefined));
        return sboocpsEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('sboocpsInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

/************************/
/* Trampoline Evaluator */
/************************/

function trampolineEval(form) {
  const kStack = new TrampolineControlStack();
  kStack.push(trampolineEndCont);
  let bounce = new EvalReq(form, nullLocalEnv);
  while (true) {
    if (signalArray[0] === 1) {
      throw new Aborted();
    }
    if (bounce instanceof EvalReq) {
      try {
        bounce = trampolineEvalForm(bounce.form, bounce.lenv, kStack);
      } catch(exception) {
        bounce = kStack.handleError(exception);
      }
    } else {
      const k = kStack.popCont();
      if (k instanceof TrampolineEndCont) {
        return bounce;
      } else {
        try {
          bounce = k.invoke(bounce);
        } catch(exception) {
          bounce = kStack.handleError(exception);
        }
      }
    }
  }
}

class TrampolineControlStack {
  constructor() {
    this.stack = []; // element: TrampolineCont, TrampolineErrorHandler, or Frame
  }
  push(element) {
    this.stack.push(element);
  }
  popCont() {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof TrampolineCont) {
        return element;
      }
    }
  }
  handleError(exception) {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof TrampolineErrorHandler) {
        return new EVLString(exception.name);
      } else if (element instanceof TrampolineEndCont) {
        throw exception;
      }
    }
  }
  ref(namespace, variable) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.ref(namespace, variable);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.set(namespace, variable, value);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.set(namespace, variable, value);
  }
}

function trampolineEvalForm(form, lenv, kStack) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return trampolineEvalQuote(form, lenv, kStack);
      case prognVariable:
        return trampolineEvalProgn(form, lenv, kStack);
      case ifVariable:
        return trampolineEvalIf(form, lenv, kStack);
      case _vlambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, kStack);
      case _mlambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, kStack);
      case _flambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, kStack);
      case _dlambdaVariable:
        return trampolineEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, kStack);
      case vrefVariable:
        return trampolineEvalRef(LEX_SCOPE, VAL_NS, form, lenv, kStack);
      case vsetVariable:
        return trampolineEvalSet(LEX_SCOPE, VAL_NS, form, lenv, kStack);
      case frefVariable:
        return trampolineEvalRef(LEX_SCOPE, FUN_NS, form, lenv, kStack);
      case fsetVariable:
        return trampolineEvalSet(LEX_SCOPE, FUN_NS, form, lenv, kStack);
      case drefVariable:
        return trampolineEvalRef(DYN_SCOPE, VAL_NS, form, lenv, kStack);
      case dsetVariable:
        return trampolineEvalSet(DYN_SCOPE, VAL_NS, form, lenv, kStack);
      case _forEachVariable:
        forEachNotImplemented();
      case _catchErrorsVariable:
        return trampolineEvalCatchErrors(form, lenv, kStack);
      case applyVariable:
        return trampolineEvalApplication(false, true, form, lenv, kStack);
      case multipleValueCallVariable:
        return trampolineEvalApplication(true, false, form, lenv, kStack);
      case multipleValueApplyVariable:
        return trampolineEvalApplication(true, true, form, lenv, kStack);
      default:
        return trampolineEvalApplication(false, false, form, lenv, kStack);
    }
  } else if (form instanceof EVLVariable) {
    return lenv.ref(VAL_NS, form);
  } else {
    return form;
  }
}

class TrampolineCont { // abstract class
  constructor(lenv, kStack) {
    this.lenv = lenv;
    this.kStack = kStack;
  }
}

class TrampolineEndCont extends TrampolineCont {
  constructor() {
    super(null, null);
  }
}

const trampolineEndCont = new TrampolineEndCont();

function trampolineEvalQuote(form, lenv, kStack) {
  const [object] = analyzeQuote(form);
  return object;
}

function trampolineEvalProgn(form, lenv, kStack) {
  const [forms] = analyzeProgn(form);
  return trampolineEvalForms(forms, lenv, kStack);
}

function trampolineEvalForms(forms, lenv, kStack) {
  if (forms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return new EvalReq(forms.car, lenv);
  } else {
    kStack.push(new TrampolineButLastFormCont(forms, lenv, kStack));
    return new EvalReq(forms.car, lenv);
  }
}

class TrampolineButLastFormCont extends TrampolineCont {
  constructor(forms, lenv, kStack) {
    super(lenv, kStack);
    this.forms = forms;
  }
  invoke(result) {
    const {forms, lenv, kStack} = this;
    return trampolineEvalForms(forms.cdr, lenv, kStack);
  }
}

function trampolineEvalIf(form, lenv, kStack) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  kStack.push(new TrampolineIfTestFormCont(thenForm, elseForm, lenv, kStack));
  return new EvalReq(testForm, lenv);
}

class TrampolineIfTestFormCont extends TrampolineCont {
  constructor(thenForm, elseForm, lenv, kStack) {
    super(lenv, kStack);
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  invoke(result) {
    const {thenForm, elseForm, lenv, kStack} = this;
    const test = result.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return new EvalReq(thenForm, lenv);
      case EVLBoolean.FALSE:
        return new EvalReq(elseForm, lenv);
      default:
        ifTestFormError();
    }
  }
}

function trampolineEvalLambda(scope, namespace, macro, form, lenv, kStack) {
  const [variables, variadic, forms] = analyzeLambda(form);
  return new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv);
}

function trampolineEvalRef(scope, namespace, form, lenv, kStack) {
  const [variable] = analyzeRef(form);
  switch (scope) {
    case LEX_SCOPE:
      return lenv.ref(namespace, variable);
    case DYN_SCOPE:
      return kStack.ref(namespace, variable);
    default:
      throw new CannotHappen('trampolineEvalRef');
  }
}

function trampolineEvalSet(scope, namespace, form, lenv, kStack) {
  const [variable, valueForm] = analyzeSet(form);
  kStack.push(new TrampolineSetValueFormCont(scope, namespace, variable, lenv, kStack));
  return new EvalReq(valueForm, lenv);
}

class TrampolineSetValueFormCont extends TrampolineCont {
  constructor(scope, namespace, variable, lenv, kStack) {
    super(lenv, kStack);
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {scope, namespace, variable, lenv, kStack} = this;
    const value = result.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return lenv.set(namespace, variable, value);
      case DYN_SCOPE:
        return kStack.set(namespace, variable, value);
      default:
        throw new CannotHappen('TrampolineSetValueFormCont.invoke');
    }
  }
}

function trampolineEvalCatchErrors(form, lenv, kStack) {
  const [tryForm] = analyzeCatchErrors(form);
  kStack.push(new TrampolineErrorHandler());
  kStack.push(new TrampolineCatchErrorsTryFormCont(lenv, kStack));
  return new EvalReq(tryForm, lenv);
}

class TrampolineErrorHandler {
}

class TrampolineCatchErrorsTryFormCont extends TrampolineCont {
  constructor(lenv, kStack) {
    super(lenv, kStack);
  }
  invoke(result) {
    const {lenv, kStack} = this;
    return EVLVoid.VOID;
  }
}

function trampolineEvalApplication(mv, apply, form, lenv, kStack) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  kStack.push(new TrampolineOperatorCont(mv, apply, operator, operands, lenv, kStack));
  return trampolineEvalOperator(operator, lenv, kStack);
}

function trampolineEvalOperator(operator, lenv, kStack) {
  if (operator instanceof EVLVariable) {
    return lenv.ref(FUN_NS, operator);
  } else {
    return new EvalReq(operator, lenv);
  }
}

class TrampolineOperatorCont extends TrampolineCont {
  constructor(mv, apply, operator, operands, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.apply = apply;
    this.operator = operator;
    this.operands = operands;
  }
  invoke(result) {
    const {mv, apply, operator, operands, lenv, kStack} = this;
    const fn = result.primaryValue();
    const macro = operator instanceof EVLVariable && fn instanceof EVLClosure && fn.macro;
    kStack.push(new TrampolineOperandsCont(apply, macro, fn, lenv, kStack));
    return trampolineEvalOperands(mv, macro, operands, [], lenv, kStack);
  }
}

function trampolineEvalOperands(mv, macro, operands, args, lenv, kStack) {
  if (operands === EVLEmptyList.NIL) {
    return args;
  } else {
    if (macro) {
      args.push(operands.car);
      return trampolineEvalOperands(mv, macro, operands.cdr, args, lenv, kStack);
    } else {
      kStack.push(new TrampolineOperandCont(mv, macro, operands, args, lenv, kStack));
      return new EvalReq(operands.car, lenv);
    }
  }
}

class TrampolineOperandCont extends TrampolineCont {
  constructor(mv, macro, operands, args, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.macro = macro;
    this.operands = operands;
    this.args = args;
  }
  invoke(result) {
    const {mv, macro, operands, args, lenv, kStack} = this;
    if (mv) {
      result.allValues().forEach(value => args.push(value));
    } else {
      args.push(result.primaryValue());
    }
    return trampolineEvalOperands(mv, macro, operands.cdr, args, lenv, kStack);
  }
}

class TrampolineOperandsCont extends TrampolineCont {
  constructor(apply, macro, fn, lenv, kStack) {
    super(lenv, kStack);
    this.apply = apply;
    this.macro = macro;
    this.fn = fn;
  }
  invoke(args) {
    const {apply, macro, fn, lenv, kStack} = this;
    return trampolineInvokeFun(apply, macro, fn, args, lenv, kStack);
  }
}

function trampolineInvokeFun(apply, macro, fn, args, lenv, kStack) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        if (macro) {
          kStack.push(new TrampolineMacroCont(lenv, kStack));
        }
        return trampolineEvalForms(fn.forms, elenv, kStack);
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.variables, values, undefined));
        return trampolineEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('trampolineInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

class TrampolineMacroCont extends TrampolineCont {
  constructor(lenv, kStack) {
    super(lenv, kStack);
  }
  invoke(result) {
    const {lenv, kStack} = this;
    const expansion = result.primaryValue();
    return new EvalReq(expansion, lenv);
  }
}

/**************************/
/* Trampoline++ Evaluator */
/**************************/

function trampolineppEval(form, lenv = null) {
  if (lenv === null) {
    form = trampolineppPreprocessForm(form, nullLocalEnv);
    lenv = nullLocalEnv;
  }
  const kStack = new TrampolineppControlStack();
  kStack.push(trampolineppEndCont);
  let bounce = new EvalReq(form, lenv);
  while (true) {
    if (signalArray[0] === 1) {
      throw new Aborted();
    }
    if (bounce instanceof EvalReq) {
      try {
        bounce = bounce.form.eval(bounce.lenv, kStack);
      } catch(exception) {
        bounce = kStack.handleError(exception);
      }
    } else {
      const k = kStack.popCont();
      if (k instanceof TrampolineppEndCont) {
        return bounce;
      } else {
        try {
          bounce = k.invoke(bounce);
        } catch(exception) {
          bounce = kStack.handleError(exception);
        }
      }
    }
  }
}

class TrampolineppControlStack {
  constructor() {
    this.stack = []; // element: TrampolineppCont, TrampolineppErrorHandler, or Frame
  }
  push(element) {
    this.stack.push(element);
  }
  popCont() {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof TrampolineppCont) {
        return element;
      }
    }
  }
  handleError(exception) {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof TrampolineppErrorHandler) {
        return new EVLString(exception.name);
      } else if (element instanceof TrampolineppEndCont) {
        throw exception;
      }
    }
  }
  ref(namespace, variable) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.ref(namespace, variable);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const element = this.stack[i];
      if (element instanceof Frame) {
        const result = element.set(namespace, variable, value);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return GlobalEnv.set(namespace, variable, value);
  }
}

function trampolineppPreprocessForm(form, lenv) {
  if (form instanceof EVLEmptyList) {
    emptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return trampolineppPreprocessQuote(form, lenv);
      case prognVariable:
        return trampolineppPreprocessProgn(form, lenv);
      case ifVariable:
        return trampolineppPreprocessIf(form, lenv);
      case _vlambdaVariable:
        return trampolineppPreprocessLambda(LEX_SCOPE, VAL_NS, false, form, lenv);
      case _mlambdaVariable:
        return trampolineppPreprocessLambda(LEX_SCOPE, VAL_NS, true, form, lenv);
      case _flambdaVariable:
        return trampolineppPreprocessLambda(LEX_SCOPE, FUN_NS, false, form, lenv);
      case _dlambdaVariable:
        return trampolineppPreprocessLambda(DYN_SCOPE, VAL_NS, false, form, lenv);
      case vrefVariable:
        return trampolineppPreprocessRef(LEX_SCOPE, VAL_NS, form, lenv);
      case vsetVariable:
        return trampolineppPreprocessSet(LEX_SCOPE, VAL_NS, form, lenv);
      case frefVariable:
        return trampolineppPreprocessRef(LEX_SCOPE, FUN_NS, form, lenv);
      case fsetVariable:
        return trampolineppPreprocessSet(LEX_SCOPE, FUN_NS, form, lenv);
      case drefVariable:
        return trampolineppPreprocessRef(DYN_SCOPE, VAL_NS, form, lenv);
      case dsetVariable:
        return trampolineppPreprocessSet(DYN_SCOPE, VAL_NS, form, lenv);
      case _forEachVariable:
        return trampolineppPreprocessForEach(form, lenv);
      case _catchErrorsVariable:
        return trampolineppPreprocessCatchErrors(form, lenv);
      case applyVariable:
        return trampolineppPreprocessApplication(false, true, form, lenv);
      case multipleValueCallVariable:
        return trampolineppPreprocessApplication(true, false, form, lenv);
      case multipleValueApplyVariable:
        return trampolineppPreprocessApplication(true, true, form, lenv);
      default:
        return trampolineppPreprocessApplication(false, false, form, lenv);
    }
  } else if (form instanceof EVLVariable) {
    return trampolineppPreprocessRef2(LEX_SCOPE, VAL_NS, form, lenv);
  } else {
    return new TrampolineppQuote(form);
  }
}

function trampolineppPreprocessForms(forms, lenv) {
  if (forms === EVLEmptyList.NIL) {
    return EVLEmptyList.NIL;
  } else {
    return new EVLCons(
      trampolineppPreprocessForm(forms.car, lenv),
      trampolineppPreprocessForms(forms.cdr, lenv)
    );
  }
}

class TrampolineppCont { // abstract class
  constructor(lenv, kStack) {
    this.lenv = lenv;
    this.kStack = kStack;
  }
}

class TrampolineppEndCont extends TrampolineppCont {
  constructor() {
    super(null, null);
  }
}

const trampolineppEndCont = new TrampolineppEndCont();

class TrampolineppForm { // abstract class
}

function trampolineppPreprocessQuote(form, lenv) {
  const [object] = analyzeQuote(form);
  return new TrampolineppQuote(object);
}

class TrampolineppQuote extends TrampolineppForm {
  constructor(object) {
    super();
    this.object = object;
  }
  eval(lenv, kStack) {
    const {object} = this;
    return object;
  }
}

function trampolineppPreprocessProgn(form, lenv) {
  const [forms] = analyzeProgn(form);
  const preprocessedForms = trampolineppPreprocessForms(forms, lenv);
  return new TrampolineppProgn(preprocessedForms);
}

class TrampolineppProgn extends TrampolineppForm {
  constructor(forms) {
    super();
    this.forms = forms;
  }
  eval(lenv, kStack) {
    const {forms} = this;
    return trampolineppEvalForms(forms, lenv, kStack);
  }
}

function trampolineppEvalForms(forms, lenv, kStack) {
  if (forms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else if (forms.cdr === EVLEmptyList.NIL) {
    return new EvalReq(forms.car, lenv);
  } else {
    kStack.push(new TrampolineppButLastFormCont(forms, lenv, kStack));
    return new EvalReq(forms.car, lenv);
  }
}

class TrampolineppButLastFormCont extends TrampolineppCont {
  constructor(forms, lenv, kStack) {
    super(lenv, kStack);
    this.forms = forms;
  }
  invoke(result) {
    const {forms, lenv, kStack} = this;
    return trampolineppEvalForms(forms.cdr, lenv, kStack);
  }
}

function trampolineppPreprocessIf(form, lenv) {
  const [testForm, thenForm, elseForm] = analyzeIf(form);
  const preprocessedTestForm = trampolineppPreprocessForm(testForm, lenv);
  const preprocessedThenForm = trampolineppPreprocessForm(thenForm, lenv);
  const preprocessedElseForm = trampolineppPreprocessForm(elseForm, lenv);
  return new TrampolineppIf(preprocessedTestForm, preprocessedThenForm, preprocessedElseForm);
}

class TrampolineppIf extends TrampolineppForm {
  constructor(testForm, thenForm, elseForm) {
    super();
    this.testForm = testForm;
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  eval(lenv, kStack) {
    const {testForm, thenForm, elseForm} = this;
    kStack.push(new TrampolineppIfTestFormCont(thenForm, elseForm, lenv, kStack));
    return new EvalReq(testForm, lenv);
  }
}

class TrampolineppIfTestFormCont extends TrampolineppCont {
  constructor(thenForm, elseForm, lenv, kStack) {
    super(lenv, kStack);
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  invoke(result) {
    const {thenForm, elseForm, lenv, kStack} = this;
    const test = result.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return new EvalReq(thenForm, lenv);
      case EVLBoolean.FALSE:
        return new EvalReq(elseForm, lenv);
      default:
        ifTestFormError();
    }
  }
}

function trampolineppPreprocessLambda(scope, namespace, macro, form, lenv) {
  const [variables, variadic, forms] = analyzeLambda(form);
  switch (scope) {
    case LEX_SCOPE: {
      const elenv = new Frame(namespace, variables, new Array(variables.length).fill(null), lenv);
      const preprocessedForms = trampolineppPreprocessForms(forms, elenv);
      return new TrampolineppLambda(scope, namespace, macro, variables, variadic, preprocessedForms);
    }
    case DYN_SCOPE: {
      const preprocessedForms = trampolineppPreprocessForms(forms, lenv);
      return new TrampolineppLambda(scope, namespace, macro, variables, variadic, preprocessedForms);
    }
    default:
      throw new CannotHappen('trampolineppPreprocessLambda');
  }
}

class TrampolineppLambda extends TrampolineppForm {
  constructor(scope, namespace, macro, variables, variadic, forms) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.variables = variables;
    this.variadic = variadic;
    this.forms = forms;
  }
  eval(lenv, kStack) {
    const {scope, namespace, macro, variables, variadic, forms} = this;
    return new EVLClosure(scope, namespace, macro, variables, variadic, forms, lenv);
  }
}

const optimizeLexicalVariables = true;

function trampolineppPreprocessRef(scope, namespace, form, lenv) {
  const [variable] = analyzeRef(form);
  return new trampolineppPreprocessRef2(scope, namespace, variable, lenv);
}

function trampolineppPreprocessRef2(scope, namespace, variable, lenv) {
  if (!optimizeLexicalVariables) {
    return new TrampolineppRef(scope, namespace, variable);
  } else {
    switch (scope) {
      case LEX_SCOPE:
        const [i, j, value] = lenv.preprocessorRef(namespace, variable, 0);
        if (i !== null && j !== null) {
          return new TrampolineppLRef(i, j);
        } else if (i === null && j === null) {
          return new TrampolineppGRef(namespace, variable);
        } else {
          throw new CannotHappen('trampolineppPreprocessRef2');
        }
      case DYN_SCOPE:
        return new TrampolineppDRef(namespace, variable);
      default:
        throw new CannotHappen('trampolineppPreprocessRef2');
    }
  }
}

class TrampolineppRef extends TrampolineppForm {
  constructor(scope, namespace, variable) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
  }
  eval(lenv, kStack) {
    const {scope, namespace, variable} = this;
    switch (scope) {
      case LEX_SCOPE:
        return lenv.ref(namespace, variable);
      case DYN_SCOPE:
        return kStack.ref(namespace, variable);
      default:
        throw new CannotHappen('trampolineppRef.eval');
    }
  }
}

class TrampolineppLRef extends TrampolineppForm {
  constructor(i, j) {
    super();
    this.i = i;
    this.j = j;
  }
  eval(lenv, kStack) {
    const {i, j} = this;
    let frame = lenv;
    for (let n = i; n > 0; n--) {
      frame = frame.next;
    }
    return frame.values[j];
  }
}

class TrampolineppGRef extends TrampolineppForm {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  eval(lenv, kStack) {
    const {namespace, variable} = this;
    return GlobalEnv.ref(namespace, variable);
  }
}

class TrampolineppDRef extends TrampolineppForm {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  eval(lenv, kStack) {
    const {namespace, variable} = this;
    return kStack.ref(namespace, variable);
  }
}

function trampolineppPreprocessSet(scope, namespace, form, lenv) {
  const [variable, valueForm] = analyzeSet(form);
  const preprocessedValueForm = trampolineppPreprocessForm(valueForm, lenv);
  if (!optimizeLexicalVariables) {
    return new TrampolineppSet(scope, namespace, variable, preprocessedValueForm);
  } else {
    switch (scope) {
      case LEX_SCOPE:
        const [i, j, value] = lenv.preprocessorRef(namespace, variable, 0);
        if (i !== null && j !== null) {
          return new TrampolineppLSet(i, j, preprocessedValueForm);
        } else if (i === null && j === null) {
          return new TrampolineppGSet(namespace, variable, preprocessedValueForm);
        } else {
          throw new CannotHappen('trampolineppPreprocessSet');
        }
      case DYN_SCOPE:
        return new TrampolineppDSet(namespace, variable, preprocessedValueForm);
      default:
        throw new CannotHappen('trampolineppPreprocessSet');
    }
  }
}

class TrampolineppSet extends TrampolineppForm {
  constructor(scope, namespace, variable, valueForm) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
    this.valueForm = valueForm;
  }
  eval(lenv, kStack) {
    const {scope, namespace, variable, valueForm} = this;
    kStack.push(new TrampolineppSetValueFormCont(scope, namespace, variable, lenv, kStack));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppSetValueFormCont extends TrampolineppCont {
  constructor(scope, namespace, variable, lenv, kStack) {
    super(lenv, kStack);
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {scope, namespace, variable, lenv, kStack} = this;
    const value = result.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return lenv.set(namespace, variable, value);
      case DYN_SCOPE:
        return kStack.set(namespace, variable, value);
      default:
        throw new CannotHappen('TrampolineppSetValueFormCont.invoke');
    }
  }
}

class TrampolineppLSet extends TrampolineppForm {
  constructor(i, j, valueForm) {
    super();
    this.i = i;
    this.j = j;
    this.valueForm = valueForm;
  }
  eval(lenv, kStack) {
    const {i, j, valueForm} = this;
    kStack.push(new TrampolineppLSetValueFormCont(i, j, lenv, kStack));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppLSetValueFormCont extends TrampolineppCont {
  constructor(i, j, lenv, kStack) {
    super(lenv, kStack);
    this.i = i;
    this.j = j;
  }
  invoke(result) {
    const {i, j, lenv, kStack} = this;
    const value = result.primaryValue();
    let frame = lenv;
    for (let n = i; n > 0; n--) {
      frame = frame.next;
    }
    return frame.values[j] = value;
  }
}

class TrampolineppGSet extends TrampolineppForm {
  constructor(namespace, variable, valueForm) {
    super();
    this.namespace = namespace;
    this.variable = variable;
    this.valueForm = valueForm;
  }
  eval(lenv, kStack) {
    const {namespace, variable, valueForm} = this;
    kStack.push(new TrampolineppGSetValueFormCont(namespace, variable, lenv, kStack));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppGSetValueFormCont extends TrampolineppCont {
  constructor(namespace, variable, lenv, kStack) {
    super(lenv, kStack);
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {namespace, variable, lenv, kStack} = this;
    const value = result.primaryValue();
    return GlobalEnv.set(namespace, variable, value);
  }
}

class TrampolineppDSet extends TrampolineppForm {
  constructor(namespace, variable, valueForm) {
    super();
    this.namespace = namespace;
    this.variable = variable;
    this.valueForm = valueForm;
  }
  eval(lenv, kStack) {
    const {namespace, variable, valueForm} = this;
    kStack.push(new TrampolineppDSetValueFormCont(namespace, variable, lenv, kStack));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppDSetValueFormCont extends TrampolineppCont {
  constructor(namespace, variable, lenv, kStack) {
    super(lenv, kStack);
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(result) {
    const {namespace, variable, lenv, kStack} = this;
    const value = result.primaryValue();
    return kStack.set(namespace, variable, value);
  }
}

function trampolineppPreprocessForEach(form, lenv) {
  const [functionForm, listForm] = analyzeForEach(form);
  const preprocessedFunctionForm = trampolineppPreprocessForm(functionForm, lenv);
  const preprocessedListForm = trampolineppPreprocessForm(listForm, lenv);
  return new TrampolineppForEach(preprocessedFunctionForm, preprocessedListForm);
}

class TrampolineppForEach extends TrampolineppForm {
  constructor(functionForm, listForm) {
    super();
    this.functionForm = functionForm;
    this.listForm = listForm;
  }
  eval(lenv, kStack) {
    forEachNotImplemented();
  }
}

function trampolineppPreprocessCatchErrors(form, lenv) {
  const [tryForm] = analyzeCatchErrors(form);
  const preprocessedTryForm = trampolineppPreprocessForm(tryForm, lenv);
  return new TrampolineppCatchErrors(preprocessedTryForm);
}

class TrampolineppCatchErrors extends TrampolineppForm {
  constructor(tryForm) {
    super();
    this.tryForm = tryForm;
  }
  eval(lenv, kStack) {
    const {tryForm} = this;
    kStack.push(new TrampolineppErrorHandler());
    kStack.push(new TrampolineppCatchErrorsTryFormCont(lenv, kStack));
    return new EvalReq(tryForm, lenv);
  }
}

class TrampolineppErrorHandler {
}

class TrampolineppCatchErrorsTryFormCont extends TrampolineppCont {
  constructor(lenv, kStack) {
    super(lenv, kStack);
  }
  invoke(result) {
    const {lenv, kStack} = this;
    return EVLVoid.VOID;
  }
}

function trampolineppPreprocessApplication(mv, apply, form, lenv) {
  const [operator, operands] = analyzeApplication(mv, apply, form);
  if (operator instanceof EVLVariable) {
    const [i, j, fn] = lenv.preprocessorRef(FUN_NS, operator, 0);
    if (fn instanceof EVLClosure && fn.macro) {
      const values = mapClosureArgs(false, listToArray(operands), fn.variables, fn.variadic);
      const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
      const expansion = trampolineppEval(new TrampolineppProgn(fn.forms), elenv).primaryValue();
      return trampolineppPreprocessForm(expansion, lenv);
    } else {
      const preprocessedOperator = trampolineppPreprocessRef2(LEX_SCOPE, FUN_NS, operator, lenv);
      const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
      return new TrampolineppApplication(mv, apply, preprocessedOperator, preprocessedOperands);
    }
  } else if (isMacroLet(operator, operands)) {
    const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
    const [variables, variadic, forms] = analyzeLambda(operator);
    const values = listToArray(preprocessedOperands).map(preprocessedOperand => preprocessedOperand.eval(nullLocalEnv, null));
    const elenv = new Frame(FUN_NS, variables, values, lenv);
    const preprocessedForms = trampolineppPreprocessForms(forms, elenv);
    const preprocessedOperator = new TrampolineppLambda(LEX_SCOPE, FUN_NS, false, variables, variadic, preprocessedForms);
    return new TrampolineppApplication(mv, apply, preprocessedOperator, preprocessedOperands);
  } else {
    const preprocessedOperator = trampolineppPreprocessForm(operator, lenv);
    const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
    return new TrampolineppApplication(mv, apply, preprocessedOperator, preprocessedOperands);
  }
}

function isMacroLet(operator, operands) {
  if (!(operator instanceof EVLCons)) return false;
  if (operator.car !== _flambdaVariable) return false;
  while (operands !== EVLEmptyList.NIL) {
    const operand = operands.car;
    if (!(operand instanceof EVLCons)) return false;
    if (operand.car !== mlambdaVariable) return false;
    operands = operands.cdr;
  }
  return true;
}

class TrampolineppApplication extends TrampolineppForm {
  constructor(mv, apply, operator, operands) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.operator = operator;
    this.operands = operands;
  }
  eval(lenv, kStack) {
    const {mv, apply, operator, operands} = this;
    kStack.push(new TrampolineppOperatorCont(mv, apply, operands, lenv, kStack));
    return trampolineppEvalOperator(operator, lenv, kStack);
  }
}

function trampolineppEvalOperator(operator, lenv, kStack) {
  return new EvalReq(operator, lenv);
}

class TrampolineppOperatorCont extends TrampolineppCont {
  constructor(mv, apply, operands, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.apply = apply;
    this.operands = operands;
  }
  invoke(result) {
    const {mv, apply, operands, lenv, kStack} = this;
    const fn = result.primaryValue();
    kStack.push(new TrampolineppOperandsCont(apply, fn, lenv, kStack));
    return trampolineppEvalOperands(mv, operands, [], lenv, kStack);
  }
}

function trampolineppEvalOperands(mv, operands, args, lenv, kStack) {
  if (operands === EVLEmptyList.NIL) {
    return args;
  } else {
    kStack.push(new TrampolineppOperandCont(mv, operands, args, lenv, kStack));
    return new EvalReq(operands.car, lenv);
  }
}

class TrampolineppOperandCont extends TrampolineppCont {
  constructor(mv, operands, args, lenv, kStack) {
    super(lenv, kStack);
    this.mv = mv;
    this.operands = operands;
    this.args = args;
  }
  invoke(result) {
    const {mv, operands, args, lenv, kStack} = this;
    if (mv) {
      result.allValues().forEach(value => args.push(value));
    } else {
      args.push(result.primaryValue());
    }
    return trampolineppEvalOperands(mv, operands.cdr, args, lenv, kStack);
  }
}

class TrampolineppOperandsCont extends TrampolineppCont {
  constructor(apply, fn, lenv, kStack) {
    super(lenv, kStack);
    this.apply = apply;
    this.fn = fn;
  }
  invoke(args) {
    const {apply, fn, lenv, kStack} = this;
    return trampolineppInvokeFun(apply, fn, args, lenv, kStack);
  }
}

function trampolineppInvokeFun(apply, fn, args, lenv, kStack) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = mapPrimFunArgs(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = mapClosureArgs(apply, args, fn.variables, fn.variadic);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.variables, values, fn.lenv);
        return trampolineppEvalForms(fn.forms, elenv, kStack);
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.variables, values, undefined));
        return trampolineppEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('trampolineppInvokeFun');
    }
  } else {
    applicationOperatorFormError();
  }
}

/**********************************/
/* Primitive Function Definer (1) */
/**********************************/

const primitiveFunctions = new Map();

function primitiveFunction(name, arityMin, arityMax, jsFunction) {
  primitiveFunctions.set(name, [arityMin, arityMax, jsFunction]);
}

const ordinalRules = new Intl.PluralRules('en-US', {type: 'ordinal'});
const ordinalSuffixes = new Map([['one', 'st'], ['two', 'nd'], ['few', 'rd'], ['other', 'th']]);

function ordinalNumber(n) {
  return n + ordinalSuffixes.get(ordinalRules.select(n));
}

function checkType(args, n, constructor) {
  const arg = args[n];
  if (arg instanceof constructor) {
    return arg;
  } else {
    throw new EvaluatorError(`The ${ordinalNumber(n + 1)} argument is not of type ${constructor.name}.`);
  }
}

/**********/
/* Bounce */
/**********/

class Bounce { // abstract class
}

/**********************/
/* Evaluation Request */
/**********************/

class EvalReq extends Bounce {
  constructor(form, lenv) {
    super();
    this.form = form;
    this.lenv = lenv;
  }
}

/**********/
/* Result */
/**********/

class Result extends Bounce { // abstract class
  constructor() {
    super();
  }
}

/**************/
/* EVLObjects */
/**************/

class EVLObjects extends Result {
  constructor(objects) {
    super();
    this.objects = objects;
  }
  primaryValue() {
    return this.objects.length === 0 ? EVLVoid.VOID : this.objects[0];
  }
  allValues() {
    return this.objects;
  }
}

/*************/
/* EVLObject */
/*************/

class EVLObject extends Result { // abstract class
  constructor() {
    super();
  }
  primaryValue() {
    return this;
  }
  allValues() {
    return [this];
  }
  eql(that) {
    return this === that;
  }
}

primitiveFunction('object?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLObject);
});

primitiveFunction('eq?', 2, 2, function(args) {
  return evlBoolean(args[0] === args[1]);
});

primitiveFunction('eql?', 2, 2, function(args) {
  return evlBoolean(args[0].eql(args[1]));
});

/***********/
/* EVLVoid */
/***********/

class EVLVoid extends EVLObject {
  constructor() {
    super();
  }
  toString() {
    return '#v';
  }
}

EVLVoid.VOID = new EVLVoid();

function nullToVoid(x) {
  return x === null ? EVLVoid.VOID : x;
}

primitiveFunction('void?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLVoid);
});

/**************/
/* EVLBoolean */
/**************/

class EVLBoolean extends EVLObject {
  constructor(jsValue) {
    super();
    this.jsValue = jsValue; // javascript boolean
  }
  toString() {
    return this.jsValue ? '#t' : '#f';
  }
}

EVLBoolean.TRUE = new EVLBoolean(true);
EVLBoolean.FALSE = new EVLBoolean(false);

function evlBoolean(jsBoolean) {
  return jsBoolean ? EVLBoolean.TRUE : EVLBoolean.FALSE;
}

primitiveFunction('boolean?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLBoolean);
});

/*************/
/* EVLNumber */
/*************/

class EVLNumber extends EVLObject {
  constructor(jsValue) {
    super();
    this.jsValue = jsValue; // javascript number
  }
  eql(that) {
    if (that instanceof EVLNumber) {
      return this.jsValue === that.jsValue;
    } else {
      return false;
    }
  }
  toString() {
    return this.jsValue.toString();
  }
}

primitiveFunction('number?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLNumber);
});

primitiveFunction('_+', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return new EVLNumber(x + y);
});

primitiveFunction('_-', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return new EVLNumber(x - y);
});

primitiveFunction('_*', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return new EVLNumber(x * y);
});

primitiveFunction('_/', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return new EVLNumber(x / y);
});

primitiveFunction('%', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return new EVLNumber(x % y);
});

primitiveFunction('=', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x === y);
});

primitiveFunction('/=', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x !== y);
});

primitiveFunction('<', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x < y);
});

primitiveFunction('<=', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x <= y);
});

primitiveFunction('>', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x > y);
});

primitiveFunction('>=', 2, 2, function(args) {
  const x = checkType(args, 0, EVLNumber).jsValue;
  const y = checkType(args, 1, EVLNumber).jsValue;
  return evlBoolean(x >= y);
});

/****************/
/* EVLCharacter */
/****************/

class EVLCharacter extends EVLObject {
  constructor(jsValue) {
    super();
    this.jsValue = jsValue; // javascript string of one character
  }
  eql(that) {
    if (that instanceof EVLCharacter) {
      return this.jsValue === that.jsValue;
    } else {
      return false;
    }
  }
  toString() {
    return '#\\' + (isValidCharacter(this.jsValue) ? this.jsValue : '?');
  }
}

primitiveFunction('character?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLCharacter);
});

/*************/
/* EVLString */
/*************/

class EVLString extends EVLObject {
  constructor(jsValue) {
    super();
    this.jsValue = jsValue; // javascript string
  }
  eql(that) {
    if (that instanceof EVLString) {
      return this.jsValue === that.jsValue;
    } else {
      return false;
    }
  }
  toString() {
    let string = '';
    string += '"';
    for (const char of this.jsValue) {
      if (!isValidCharacter(char)) {
        string += '?';
      } else if (char === '"' || char === '\\') {
        string += '\\' + char;
      } else {
        string += char;
      }
    }
    string += '"';
    return string;
  }
}

primitiveFunction('string?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLString);
});

/*************/
/* EVLSymbol */
/*************/

class EVLSymbol extends EVLObject { // abstract class
  constructor(name) {
    super();
    this.name = name; // javascipt string
  }
  toString() {
    let string = '';
    if (this instanceof EVLKeyword) {
      string += ':';
    }
    for (const char of this.name) {
      if (!isValidCharacter(char)) {
        string += '?';
      } else if (isWhitespaceCharacter(char) || isTerminatingCharacter(char) || char === '\\') {
        string += '\\' + char;
      } else {
        string += char;
      }
    }
    return string;
  }
}

primitiveFunction('symbol?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLSymbol);
});

/**************/
/* EVLKeyword */
/**************/

class EVLKeyword extends EVLSymbol {
  constructor(name) {
    super(name);
  }
}

const keywordPackage = new Map();

function internKeyword(name) {
  let keyword = keywordPackage.get(name);
  if (keyword === undefined) {
    keywordPackage.set(name, keyword = new EVLKeyword(name));
  }
  return keyword;
}

primitiveFunction('keyword?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLKeyword);
});

primitiveFunction('make-keyword', 1, 1, function(args) {
  const name = checkType(args, 0, EVLString).jsValue;
  return new EVLKeyword(name);
});

/***************/
/* EVLVariable */
/***************/

class EVLVariable extends EVLSymbol {
  constructor(name) {
    super(name);
    this.value = null;
    this.function = null;
  }
}

const variablePackage = new Map();

function internVariable(name) {
  let variable = variablePackage.get(name);
  if (variable === undefined) {
    variablePackage.set(name, variable = new EVLVariable(name));
  }
  return variable;
}

const notVariable = internVariable('not');
const andVariable = internVariable('and');
const orVariable = internVariable('or');
const quoteVariable = internVariable('quote');
const quasiquoteVariable = internVariable('quasiquote');
const unquoteVariable = internVariable('unquote');
const unquoteSplicingVariable = internVariable('unquote-splicing');
const prognVariable = internVariable('progn');
const ifVariable = internVariable('if');
const _vlambdaVariable = internVariable('_vlambda');
const _mlambdaVariable = internVariable('_mlambda');
const mlambdaVariable = internVariable('mlambda');
const _flambdaVariable = internVariable('_flambda');
const _dlambdaVariable = internVariable('_dlambda');
const vrefVariable = internVariable('vref');
const vsetVariable = internVariable('vset!');
const frefVariable = internVariable('fref');
const fsetVariable = internVariable('fset!');
const drefVariable = internVariable('dref');
const dsetVariable = internVariable('dset!');
const _forEachVariable = internVariable('_for-each');
const _catchErrorsVariable = internVariable('_catch-errors');
const applyVariable = internVariable('apply');
const multipleValueCallVariable = internVariable('multiple-value-call');
const multipleValueApplyVariable = internVariable('multiple-value-apply');

primitiveFunction('variable?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLVariable);
});

primitiveFunction('make-variable', 1, 1, function(args) {
  const name = checkType(args, 0, EVLString).jsValue;
  return new EVLVariable(name);
});

primitiveFunction('variable-value', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return nullToVoid(variable.value);
});

primitiveFunction('variable-set-value!', 2, 2, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return variable.value = args[1];
});

primitiveFunction('variable-value-bound?', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return evlBoolean(variable.value !== null);
});

primitiveFunction('variable-unbind-value!', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return variable.value = null, EVLVoid.VOID;
});

primitiveFunction('variable-function', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return nullToVoid(variable.function);
});

primitiveFunction('variable-set-function!', 2, 2, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return variable.function = args[1];
});

primitiveFunction('variable-function-bound?', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return evlBoolean(variable.function !== null);
});

primitiveFunction('variable-unbind-function!', 1, 1, function(args) {
  const variable = checkType(args, 0, EVLVariable);
  return variable.function = null, EVLVoid.VOID;
});

/***********/
/* EVLList */
/***********/

class EVLList extends EVLObject { // abstract class
  constructor() {
    super();
  }
  toString() {
    let string = '';
    let first = true;
    string += '(';
    let list = this;
    while (list !== EVLEmptyList.NIL) {
      if (first) {
        first = false;
      } else {
        string += ' ';
      }
      string += list.car.toString();
      if (list.cdr instanceof EVLList) {
        list = list.cdr;
      } else {
        string += ' . ' + list.cdr.toString();
        break;
      }
    }
    string += ')';
    return string;
  }
}

primitiveFunction('list?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLList);
});

/****************/
/* EVLEmptyList */
/****************/

class EVLEmptyList extends EVLList {
  constructor() {
    super();
  }
}

EVLEmptyList.NIL = new EVLEmptyList();

primitiveFunction('empty-list?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLEmptyList);
});

/***********/
/* EVLCons */
/***********/

class EVLCons extends EVLList {
  constructor(car, cdr) {
    super();
    this.car = car; // EVLObject
    this.cdr = cdr; // EVLObject
  }
}

primitiveFunction('cons?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLCons);
});

primitiveFunction('cons', 2, 2, function(args) {
  return new EVLCons(args[0], args[1]);
});

primitiveFunction('car', 1, 1, function(args) {
  const cons = checkType(args, 0, EVLCons);
  return cons.car;
});

primitiveFunction('set-car!', 2, 2, function(args) {
  const cons = checkType(args, 0, EVLCons);
  return cons.car = args[1];
});

primitiveFunction('cdr', 1, 1, function(args) {
  const cons = checkType(args, 0, EVLCons);
  return cons.cdr;
});

primitiveFunction('set-cdr!', 2, 2, function(args) {
  const cons = checkType(args, 0, EVLCons);
  return cons.cdr = args[1];
});

/*************/
/* EVLVector */
/*************/

class EVLVector extends EVLObject {
  constructor(elements) {
    super();
    this.elements = elements; // javascript array of EVLObject or null elements
  }
  toString() {
    let string = '';
    let first = true;
    string += '#(';
    for (const element of this.elements) {
      if (first) {
        first = false;
      } else {
        string += ' ';
      }
      string += nullToVoid(element).toString();
    }
    string += ')';
    return string;
  }
}

primitiveFunction('vector?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLVector);
});

/***************/
/* EVLFunction */
/***************/

class EVLFunction extends EVLObject { // abstract class
  constructor() {
    super();
  }
}

primitiveFunction('function?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLFunction);
});

/************************/
/* EVLPrimitiveFunction */
/************************/

class EVLPrimitiveFunction extends EVLFunction {
  constructor(arityMin, arityMax, jsFunction) {
    super();
    this.arityMin = arityMin;
    this.arityMax = arityMax;
    this.jsFunction = jsFunction; // javascript function
  }
  toString() {
    return '#<primitive-function>';
  }
}

primitiveFunction('primitive-function?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLPrimitiveFunction);
});

/**************/
/* EVLClosure */
/**************/

class EVLClosure extends EVLFunction {
  constructor(scope, namespace, macro, variables, variadic, forms, lenv) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.variables = variables;
    this.variadic = variadic;
    this.forms = forms;
    this.lenv = lenv;
  }
  toString() {
    return '#<closure>';
  }
}

primitiveFunction('closure?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLClosure);
});

/*****************************/
/* Other Primitive Functions */
/*****************************/

primitiveFunction('values', 0, null, function(args) {
  return new EVLObjects(args);
});

primitiveFunction('error', 1, 1, function(args) {
  const message = checkType(args, 0, EVLString).jsValue;
  throw new Error(message);
});

primitiveFunction('now', 0, 0, function(args) {
  return new EVLNumber(Date.now());
});

/**********************************/
/* Primitive Function Definer (2) */
/**********************************/

for (const [name, [arityMin, arityMax, jsFunction]] of primitiveFunctions) {
  GlobalEnv.set(FUN_NS, internVariable(name), new EVLPrimitiveFunction(arityMin, arityMax, jsFunction));
}

/********/
/* Node */
/********/

if (typeof onmessage === 'undefined') { // node
  import('node:fs').then(fs => {
    signalArray = [0];
    selectedEvaluator = 'trampolinepp';
    GlobalEnv.set(VAL_NS, internVariable('*features*'), new EVLCons(internVariable(selectedEvaluator), EVLEmptyList.NIL));
    const nargs = process.argv.length;
    let n = 2;
    while (n < nargs) {
      const arg = process.argv[n++];
      switch (arg) {
        case '-l':
          if (n === nargs) {
            usage();
          }
          const file = process.argv[n++];
          const fileContents = fs.readFileSync(file, 'utf8');
          printToConsole(evaluateAllForms(fileContents));
          break;
        case '-e':
          if (n === nargs) {
            usage();
          }
          const form = process.argv[n++];
          printToConsole(evaluateFirstForm(form));
          break;
        default:
          usage();
      }
    }
  });
}

function usage() {
  console.log('usage: -l <file> to load a file, -e <form> to evaluate a form');
  process.exit();
}

function printToConsole(response) {
  switch (response.status) {
    case COMPLETED_NORMALLY:
      console.log(response.output);
      break;
    case COMPLETED_ABNORMALLY:
      console.log(response.output);
      process.exit();
  }
}
