// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

/********************/
/* Global Variables */
/********************/

const isRunningInsideNode = (typeof process !== 'undefined') && (process.release.name === 'node');

let abortSignalArray = null;
let selectedEvaluator = null;

/*******************/
/* Interface (IDE) */
/*******************/

const FOUND_NO_FORM = 0;
const SUCCESS = 1;
const ERROR = 2;
const ABORTED = 3;
const TERMINATED = 4;

const INITIALIZE = 0;
const EVALUATE_FIRST_FORM = 1;
const EVALUATE_ALL_FORMS = 2;
const CONVERT_EVL_TO_XML = 3;

if (!isRunningInsideNode) {
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
      case CONVERT_EVL_TO_XML:
        response = convertEVLToXML(input);
        break;
      default:
        throw new CannotHappen('onmessage');
    }
    if (response !== null) {
      postMessage({id: id, ...response});
    }
  };
}

function foundNoForm() {
  return {status: FOUND_NO_FORM};
}

function success(output) {
  return {status: SUCCESS, output: output};
}

function abortedOrError(exception) {
  if (exception instanceof Aborted) {
    return {status: ABORTED};
  } else {
    return {status: ERROR, output: exception.message};
  }
}

function initialize(input) {
  abortSignalArray = new Uint8Array(input.abortSignalBuffer);
  selectedEvaluator = input.selectedEvaluator;
  initializeFeatureList([selectedEvaluator]);
  let lastResult = EVLVoid.VOID;
  for (const evlFile of input.evlFiles) {
    const tokenizer = new Tokenizer(evlFile);
    tokenizer.callback = object => lastResult = genericEval(object);
    while (true) {
      let object = null;
      try {
        object = read(tokenizer);
      } catch(exception) {
        return abortedOrError(exception);
      }
      if (object === null) {
        break;
      } else {
        try {
          lastResult = genericEval(object);
        } catch(exception) {
          return abortedOrError(exception);
        }
      }
    }
  }
  const output = lastResult.allValues().map(object => object.toString());
  return success(output);
}

function evaluateFirstForm(text) {
  if (abortSignalArray !== null) {
    abortSignalArray[0] = 0;
  }
  const tokenizer = new Tokenizer(text);
  let object = null;
  try {
    object = read(tokenizer);
  } catch(exception) {
    if (exception instanceof TruncatedToken || exception instanceof UnexpectedEndOfInput) {
      return foundNoForm();
    } else {
      return abortedOrError(exception);
    }
  }
  if (object === null) {
    return foundNoForm();
  } else {
    let result = null;
    try {
      result = genericEval(object);
    } catch(exception) {
      return abortedOrError(exception);
    }
    const output = result.allValues().map(object => object.toString());
    return success(output);
  }
}

function evaluateAllForms(text) {
  if (abortSignalArray !== null) {
    abortSignalArray[0] = 0;
  }
  let lastResult = EVLVoid.VOID;
  const tokenizer = new Tokenizer(text);
  tokenizer.callback = object => lastResult = genericEval(object);
  while (true) {
    let object = null;
    try {
      object = read(tokenizer);
    } catch(exception) {
      return abortedOrError(exception);
    }
    if (object === null) {
      break;
    } else {
      try {
        lastResult = genericEval(object);
      } catch(exception) {
        return abortedOrError(exception);
      }
    }
  }
  const output = lastResult.allValues().map(object => object.toString());
  return success(output);
}

function convertEVLToXML(text) {
  const tokenizer = new Tokenizer(text, true);
  let xml = null;
  try {
    xml = doConvertEVLToXML(tokenizer);
  } catch(exception) {
    return abortedOrError(exception);
  }
  return success(xml);
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

class TokenizerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenizerError';
  }
}

class ReaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReaderError';
  }
}

class EVLToXMLConverterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EVLToXMLConverterError';
  }
}

class FormAnalyzerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormAnalyzerError';
  }
}

class EvaluatorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluatorError';
  }
}

/*************/
/* Tokenizer */
/*************/

class TruncatedToken extends TokenizerError {
  constructor(message) {
    super(message);
    this.name = 'TruncatedToken';
  }
}

// token categories
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
const XML_START_TAG = 13; // value is an XML element name
const XML_END_TAG = 14; // value is an XML element name
const XML_EMPTY_ELEMENT_TAG = 15; // value is an XML element name
const XML_COMMENT = 16;
const DOT = 17; // the dot of dotted lists
const NUMBER = 18; // value is an EVLNumber
const KEYWORD = 19; // value is an EVLKeyword
const VARIABLE = 20; // value is an EVLVariable
const BOI = 21; // beginning of input
const EOI = 22; // end of input

const codePointRegExp = /^[a-fA-F0-9]+$/;
const numberRegExp = /^[+-]?[0-9]+(?:\.[0-9]+)?$/;
const keywordRegExp = /^:[^:]+$/;
const variableRegExp = /^[^:]+$/;

function isLeadingSurrogate(codeUnit) {
  return 0xD800 <= codeUnit && codeUnit <= 0xDBFF;
}

function isTrailingSurrogate(codeUnit) {
  return 0xDC00 <= codeUnit && codeUnit <= 0xDFFF;
}

function isSurrogate(codeUnit) {
  return isLeadingSurrogate(codeUnit) || isTrailingSurrogate(codeUnit);
}

function ensureCodePoint (charOrCodePoint) {
  if (typeof charOrCodePoint === "number") {
    // charOrCodePoint is a JavaScript number
    return charOrCodePoint;
  } else {
    // charOrCodePoint is a JavaScript string of one or two UTF-16 code units
    return charOrCodePoint.codePointAt(0);
  }
}

function isControlCharacter(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  return (0x0000 <= codePoint && codePoint <= 0x001F) || (0x007F <= codePoint && codePoint <= 0x009F);
}

function isNoncharacter(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  const x = codePoint & 0xFFFF;
  return x === 0xFFFE || x === 0xFFFF || (0xFDD0 <= codePoint && codePoint <= 0xFDEF);
}

function isWhitespaceCharacter(charOrCodePoint) {
  // https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt
  // Whitespace =
  // 0009..000D   <control-0009>..<control-000D>
  // 0020         SPACE
  // 0085         <control-0085>
  // 00A0         NO-BREAK SPACE
  // 1680         OGHAM SPACE MARK
  // 2000..200A   EN QUAD..HAIR SPACE
  // 2028         LINE SEPARATOR
  // 2029         PARAGRAPH SEPARATOR
  // 202F         NARROW NO-BREAK SPACE
  // 205F         MEDIUM MATHEMATICAL SPACE
  // 3000         IDEOGRAPHIC SPACE
  // https://www.unicode.org/L2/L2005/05012r-pattern.html
  // Pattern_Whitespace = Whitespace + Left-to-Right Mark + Right-to-Left Mark -
  // 00A0         NO-BREAK SPACE
  // 1680         OGHAM SPACE MARK
  // 180E         MONGOLIAN VOWEL SEPARATOR
  // 2000..200A   EN QUAD..HAIR SPACE
  // 202F         NARROW NO-BREAK SPACE
  // 205F         MEDIUM MATHEMATICAL SPACE
  // 3000         IDEOGRAPHIC SPACE
  const codePoint = ensureCodePoint(charOrCodePoint);
  return (
    codePoint === 0x0009 || // Horizontal Tab
    codePoint === 0x000A || // Line Feed
    codePoint === 0x000B || // Vertical Tab
    codePoint === 0x000C || // Form Feed
    codePoint === 0x000D || // Carriage Return
    codePoint === 0x0020 || // Space
    codePoint === 0x0085 || // Next Line
    codePoint === 0x200E || // Left-to-Right Mark
    codePoint === 0x200F || // Right-to-Left Mark
    codePoint === 0x2028 || // Line Separator
    codePoint === 0x2029    // Paragraph Separator
  );
}

function isSyntaxCharacter(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  return (
    codePoint === 0x0027 || // "'"
    codePoint === 0x0060 || // '`'
    codePoint === 0x002C || // ','
    codePoint === 0x0022 || // '"'
    codePoint === 0x0028 || // '('
    codePoint === 0x0029 || // ')'
    codePoint === 0x0023    // '#'
  );
}

function isXMLNameCharacter(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  return 0x61 <= codePoint && codePoint <= 0x7A; // a-z
}

function isDecimalDigit(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  return 0x30 <= codePoint && codePoint <= 0x39; // 0-9
}

class Tokenizer {
  constructor(text, convertEVLToXML = false) {
    this.text = text;
    this.convertEVLToXML = convertEVLToXML;
    this.position = 0;
    this.xmlStack = []; // array of XML element names
    this.savedCodeUnits = '';
  }
  peekCharacter(position = this.position) {
    let char = null; // JavaScript string of one or two UTF-16 code units
    const codeUnit = this.text.charCodeAt(position);
    if (isTrailingSurrogate(codeUnit)) {
      throw new TokenizerError('Lone surrogate.');
    } else if (isLeadingSurrogate(codeUnit)) {
      if (position + 1 === this.text.length) {
        throw new TokenizerError('Lone surrogate.');
      }
      const codeUnit2 = this.text.charCodeAt(position + 1);
      if (isTrailingSurrogate(codeUnit2)) {
        char = String.fromCharCode(codeUnit, codeUnit2);
      } else {
        throw new TokenizerError('Lone surrogate.');
      }
    } else {
      char = String.fromCharCode(codeUnit);
    }
    const codePoint = char.codePointAt(0);
    if (isControlCharacter(codePoint) && !isWhitespaceCharacter(codePoint)) {
      throw new TokenizerError('Invalid control character.');
    }
    if (isNoncharacter(codePoint)) {
      throw new TokenizerError('Noncharacter.');
    }
    // unassigned code points are allowed
    return char;
  }
  consumeCharacter(char) {
    this.lexeme += char;
    this.position += char.length;
  }
  nextToken() {
    this.whitespace = '';
    this.lexeme = '';
    if (this.savedCodeUnits.length !== 0) {
      this.category = CHARACTER;
      this.value = new EVLCharacter(this.savedCodeUnits.charAt(0));
      this.savedCodeUnits = this.savedCodeUnits.substring(1);
    } else {
      this.category = null;
      this.value = null;
      const pureXML = this.xmlStack.length !== 0 && !['chapter', 'section'].includes(this.xmlStack[this.xmlStack.length - 1]);
      while (this.category === null) {
        this.skipWhitespace(pureXML);
        if (this.position === this.text.length) {
          this.category = EOI;
        } else {
          this.readToken(pureXML);
        }
      }
    }
  }
  skipWhitespace(pureXML) {
    // When pureXML is true, XML character data is treated as whitespace.
    while (true) {
      if (this.position === this.text.length) {
        break;
      }
      const char = this.peekCharacter();
      if (pureXML ? char === '<' : !isWhitespaceCharacter(char)) {
        break;
      }
      this.whitespace += char;
      this.position += char.length;
    }
  }
  readToken(pureXML) {
    const char = this.peekCharacter();
    switch (char) {
      case "'":
        this.consumeCharacter(char);
        this.category = QUOTE;
        break;
      case '`':
        this.consumeCharacter(char);
        this.category = QUASIQUOTE;
        break;
      case ',':
        this.consumeCharacter(char);
        if (this.position === this.text.length) {
          this.category = UNQUOTE;
        } else {
          const char2 = this.peekCharacter();
          if (char2 === '@') {
            this.consumeCharacter(char2);
            this.category = UNQUOTE_SPLICING;
          } else {
            this.category = UNQUOTE;
          }
        }
        break;
      case '"':
        this.consumeCharacter(char);
        const string = readString(this);
        this.category = STRING;
        this.value = new EVLString(string);
        break;
      case '(':
        this.consumeCharacter(char);
        this.category = OPENING_PARENTHESIS;
        break;
      case ')':
        this.consumeCharacter(char);
        this.category = CLOSING_PARENTHESIS;
        break;
      case '#':
        this.consumeCharacter(char);
        readHashConstruct(this);
        break;
      case '<':
        if (readXMLMarkup(this, true)) {
          break;
        }
        if (pureXML) {
          throw new TokenizerError('Malformed XML markup.');
        }
        // fall through ('<' will be read again by readProtoToken)
      default:
        const protoToken = readProtoToken(this);
        if (protoToken === '.') {
          this.category = DOT;
        } else if (numberRegExp.test(protoToken)) {
          this.category = NUMBER;
          this.value = new EVLNumber(Number.parseFloat(protoToken));
        } else if (keywordRegExp.test(protoToken)) {
          this.category = KEYWORD;
          this.value = internKeyword(protoToken.substring(1));
        } else if (variableRegExp.test(protoToken)) {
          this.category = VARIABLE;
          this.value = internVariable(protoToken);
        } else {
          throw new TokenizerError('Malformed proto-token.');
        }
        break;
    }
  }
}

function escapeCharacters(chars, escapeCharacter) {
  let escapedChars = '';
  let position = 0;
  const length = chars.length;
  while (position < length) {
    let char = null; // JavaScript string of one or two UTF-16 code units
    const codeUnit = chars.charCodeAt(position);
    if (isTrailingSurrogate(codeUnit)) {
      escapedChars += unicodeEscape(codeUnit);
      position += 1;
      continue;
    } else if (isLeadingSurrogate(codeUnit)) {
      if (position + 1 === length) {
        escapedChars += unicodeEscape(codeUnit);
        position += 1;
        continue;
      }
      const codeUnit2 = chars.charCodeAt(position + 1);
      if (isTrailingSurrogate(codeUnit2)) {
        char = String.fromCharCode(codeUnit, codeUnit2);
        position += 2;
      } else {
        escapedChars += unicodeEscape(codeUnit);
        position += 1;
        continue;
      }
    } else {
      char = String.fromCharCode(codeUnit);
      position += 1;
    }
    const codePoint = char.codePointAt(0);
    if (isControlCharacter(codePoint) && !isWhitespaceCharacter(codePoint)) {
      escapedChars += unicodeEscape(codePoint);
      continue;
    }
    if (isNoncharacter(codePoint)) {
      escapedChars += unicodeEscape(codePoint);
      continue;
    }
    escapedChars += escapeCharacter(char);
  }
  return escapedChars;
}

function unicodeEscape(charOrCodePoint) {
  const codePoint = ensureCodePoint(charOrCodePoint);
  return '\\U{' + codePoint.toString(16).toUpperCase() + '}';
}

function readEscapeSequence(tokenizer) {
  // reads {xyz}, returns xyz
  let chars = '';
  if (tokenizer.position === tokenizer.text.length) {
    throw new TruncatedToken('Truncated escape sequence.');
  }
  const char = tokenizer.peekCharacter();
  tokenizer.consumeCharacter(char);
  if (char !== '{') {
    throw new TokenizerError('Malformed escape sequence.');
  }
  while (true) {
    if (tokenizer.position === tokenizer.text.length) {
      throw new TruncatedToken('Truncated escape sequence.');
    }
    const char2 = tokenizer.peekCharacter();
    tokenizer.consumeCharacter(char2);
    if (char2 === '}') {
      break;
    }
    chars += char2;
  }
  return chars;
}

function readString(tokenizer) {
  let chars = '';
  while (true) {
    if (tokenizer.position === tokenizer.text.length) {
      throw new TruncatedToken('Truncated string.');
    }
    const char = tokenizer.peekCharacter();
    tokenizer.consumeCharacter(char);
    if (char === '"') {
      break;
    }
    if (char === '\\') {
      if (tokenizer.position === tokenizer.text.length) {
        throw new TruncatedToken('Truncated escape sequence.');
      }
      const char2 = tokenizer.peekCharacter();
      tokenizer.consumeCharacter(char2);
      switch (char2) {
        case '\\':
          chars += '\\';
          break;
        case '"':
          chars += '"';
          break;
        case 't':
          chars += '\t';
          break;
        case 'n':
          chars += '\n';
          break;
        case 'v':
          chars += '\v';
          break;
        case 'f':
          chars += '\f';
          break;
        case 'r':
          chars += '\r';
          break;
        case 'U':
          const codePoint = readEscapeSequence(tokenizer);
          if (!codePointRegExp.test(codePoint)) {
            throw new TokenizerError('Malformed escape sequence.');
          }
          chars += String.fromCodePoint(Number.parseInt(codePoint, 16));
          break;
        default:
          throw new TokenizerError('Undefined escape sequence.');
      }
    } else {
      chars += char;
    }
  }
  return chars;
}

function escapeStringCharacter (char) {
  switch (char) {
    case '\\':
      return '\\\\';
    case '"':
      return '\\"';
    case '\t':
      return '\\t';
    case '\n':
      return '\\n';
    case '\v':
      return '\\v';
    case '\f':
      return '\\f';
    case '\r':
      return '\\r';
    default:
      return char;
  }
}

function readHashConstruct(tokenizer) {
  let char = null;
  let arg = '';
  while (true) {
    if (tokenizer.position === tokenizer.text.length) {
      throw new TruncatedToken('Truncated hash construct.');
    }
    char = tokenizer.peekCharacter();
    tokenizer.consumeCharacter(char);
    if (isDecimalDigit(char)) {
      arg += char;
    } else {
      break;
    }
  }
  switch (char) {
    case '(':
      tokenizer.category = HASH_OPENING_PARENTHESIS;
      break;
    case '+':
      tokenizer.category = HASH_PLUS;
      break;
    case '-':
      tokenizer.category = HASH_MINUS;
      break;
    case 'v':
      tokenizer.category = VOID;
      tokenizer.value = EVLVoid.VOID;
      break;
    case 't':
      tokenizer.category = BOOLEAN;
      tokenizer.value = EVLBoolean.TRUE;
      break;
    case 'f':
      tokenizer.category = BOOLEAN;
      tokenizer.value = EVLBoolean.FALSE;
      break;
    case '"':
      const string = readString(tokenizer);
      if (tokenizer.convertEVLToXML) {
        tokenizer.category = CHARACTER;
        tokenizer.value = null; // the value is ignored by the EVL to XML converter
      } else if (arg !== '') {
        const index = Number.parseInt(arg);
        if (index < string.length) {
          tokenizer.category = CHARACTER;
          tokenizer.value = new EVLCharacter(string.charAt(index));
        } else {
          throw new TokenizerError('Index out of bounds.');
        }
      } else if (string.length !== 0) {
        tokenizer.category = CHARACTER;
        tokenizer.value = new EVLCharacter(string.charAt(0));
        tokenizer.savedCodeUnits = string.substring(1);
      }
      break;
    default:
      throw new TokenizerError('Undefined hash construct.');
  }
}

function readXMLMarkup(tokenizer, consume) {
  let state = 0;
  let isXMLEndTag = false;
  let isXMLEmptyElementTag = false;
  let isXMLComment = false;
  let name = '';
  let position = tokenizer.position + 1; // skip '<'
  loop: while (true) {
    if (position === tokenizer.text.length) {
      return false;
    }
    const char = tokenizer.peekCharacter(position);
    position += char.length;
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
        if (char === '>') break loop;
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
  if (consume) {
    tokenizer.lexeme = tokenizer.text.slice(tokenizer.position, position);
    tokenizer.position = position;
    if (isXMLComment) {
      tokenizer.category = XML_COMMENT;
    } else if (isXMLEndTag) {
      if (tokenizer.xmlStack.length === 0) {
        throw new TokenizerError('Unexpected XML end tag.');
      }
      if (tokenizer.xmlStack[tokenizer.xmlStack.length - 1] !== name) {
        throw new TokenizerError('Unmatched XML tags.');
      }
      tokenizer.xmlStack.pop();
      tokenizer.category = XML_END_TAG;
      tokenizer.value = name;
    } else if (isXMLEmptyElementTag) {
      tokenizer.category = XML_EMPTY_ELEMENT_TAG;
      tokenizer.value = name;
    } else {
      tokenizer.xmlStack.push(name);
      tokenizer.category = XML_START_TAG;
      tokenizer.value = name;
    }
  }
  return true;
}

function readProtoToken(tokenizer) {
  let chars = '';
  while (true) {
    if (tokenizer.position === tokenizer.text.length) {
      break;
    }
    const char = tokenizer.peekCharacter();
    if (isWhitespaceCharacter(char) || isSyntaxCharacter(char)) {
      break;
    }
    if (char === '<' && readXMLMarkup(tokenizer, false)) {
      break;
    }
    tokenizer.consumeCharacter(char);
    if (char === '\\') {
      if (tokenizer.position === tokenizer.text.length) {
        throw new TruncatedToken('Truncated escape sequence.');
      }
      const char2 = tokenizer.peekCharacter();
      tokenizer.consumeCharacter(char2);
      switch (char2) {
        case '\\':
          chars += '\\';
          break;
        case '<':
          chars += '<';
          break;
        case 'U':
          const codePoint = readEscapeSequence(tokenizer);
          if (!codePointRegExp.test(codePoint)) {
            throw new TokenizerError('Malformed escape sequence.');
          }
          chars += String.fromCodePoint(Number.parseInt(codePoint, 16));
          break;
        default:
          throw new TokenizerError('Undefined escape sequence.');
      }
    } else {
      chars += char;
    }
  }
  return chars;
}

function escapeProtoTokenCharacter (char) {
  if (isWhitespaceCharacter(char) || isSyntaxCharacter(char)) {
    return unicodeEscape(char);
  } else {
    switch (char) {
      case '\\':
        return '\\\\';
      case '<':
        return '\\<';
      default:
        return char;
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

class UnexpectedEndOfInput extends ReaderError {
  constructor() {
    super('Unexpected end-of-input.');
    this.name = 'UnexpectedEndOfInput';
  }
}

function read(tokenizer) {
  const object = readObject(tokenizer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      return null;
    default:
      return object;
  }
}

function readObject(tokenizer) {
  // Returns DOT, CLOSING_PARENTHESIS, XML_END_TAG, EOI, or an object.
  // XML elements are skipped because they are treated as comments.
  while (true) {
    tokenizer.nextToken();
    switch (tokenizer.category) {
      case VOID:
      case BOOLEAN:
      case NUMBER:
      case CHARACTER:
      case STRING:
      case KEYWORD:
      case VARIABLE:
        return tokenizer.value;
      case QUOTE:
        return readAbbreviation(tokenizer, quoteVariable);
      case QUASIQUOTE:
        return readAbbreviation(tokenizer, quasiquoteVariable);
      case UNQUOTE:
        return readAbbreviation(tokenizer, unquoteVariable);
      case UNQUOTE_SPLICING:
        return readAbbreviation(tokenizer, unquoteSplicingVariable);
      case HASH_PLUS: {
        const object = readReadTimeConditional(tokenizer, true);
        if (object !== null) {
          return object;
        } else {
          break;
        }
      }
      case HASH_MINUS: {
        const object = readReadTimeConditional(tokenizer, false);
        if (object !== null) {
          return object;
        } else {
          break;
        }
      }
      case OPENING_PARENTHESIS:
        return readList(tokenizer);
      case HASH_OPENING_PARENTHESIS:
        return readVector(tokenizer);
      case DOT:
        return DOT;
      case CLOSING_PARENTHESIS:
        return CLOSING_PARENTHESIS;
      case XML_START_TAG:
        readXMLElement(tokenizer);
        break; // skip
      case XML_END_TAG:
        return XML_END_TAG;
      case XML_EMPTY_ELEMENT_TAG:
        break; // skip
      case XML_COMMENT:
        break; // skip
      case EOI:
        return EOI;
      default:
        throw new CannotHappen('readObject');
    }
  }
}

function readAbbreviation(tokenizer, variable) {
  const object = readObject(tokenizer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      throw new UnexpectedEndOfInput();
    default:
      return new EVLCons(variable, new EVLCons(object, EVLEmptyList.NIL));
  }
}

function readReadTimeConditional(tokenizer, polarity) {
  const featureExpression = readFeatureExpression(tokenizer);
  const conditionalizedObject = readConditionalizedObject(tokenizer)
  if (evaluateFeatureExpression(featureExpression) === polarity) {
    return conditionalizedObject;
  } else {
    return null;
  }
}

function readFeatureExpression(tokenizer) {
  const object = readObject(tokenizer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      throw new UnexpectedEndOfInput();
    default:
      return object;
  }
}

function readConditionalizedObject(tokenizer) {
  const object = readObject(tokenizer);
  switch (object) {
    case DOT:
      throw new UnexpectedDot();
    case CLOSING_PARENTHESIS:
      throw new UnexpectedClosingParenthesis();
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      throw new UnexpectedEndOfInput();
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

function initializeFeatureList(features) {
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  for (const feature of features) {
    const newCons = new EVLCons(internVariable(feature), EVLEmptyList.NIL);
    if (lastCons === null) {
      list = newCons;
    } else {
      lastCons.cdr = newCons;
    }
    lastCons = newCons;
  }
  GlobalEnv.set(VAL_NS, internVariable('*features*'), list);
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

function readList(tokenizer) {
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  loop: while (true) {
    const object = readObject(tokenizer);
    switch (object) {
      case DOT:
        return readDottedList(tokenizer, list, lastCons);
      case CLOSING_PARENTHESIS:
        break loop;
      case XML_END_TAG:
        throw new UnexpectedXMLEndTag();
      case EOI:
        throw new UnexpectedEndOfInput();
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

function readDottedList(tokenizer, list, lastCons) {
  if (lastCons === null) {
    throw new ReaderError('Malformed dotted list.');
  }
  const object = readObject(tokenizer);
  switch (object) {
    case DOT:
      throw new ReaderError('Malformed dotted list.');
    case CLOSING_PARENTHESIS:
      throw new ReaderError('Malformed dotted list.');
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      throw new UnexpectedEndOfInput();
    default:
      lastCons.cdr = object;
      break
  }
  const object2 = readObject(tokenizer);
  switch (object2) {
    case DOT:
      throw new ReaderError('Malformed dotted list.');
    case CLOSING_PARENTHESIS:
      return list;
    case XML_END_TAG:
      throw new UnexpectedXMLEndTag();
    case EOI:
      throw new UnexpectedEndOfInput();
    default:
      throw new ReaderError('Malformed dotted list.');
  }
}

function readVector(tokenizer) {
  const elements = [];
  loop: while (true) {
    const object = readObject(tokenizer);
    switch (object) {
      case DOT:
        throw new UnexpectedDot();
      case CLOSING_PARENTHESIS:
        break loop;
      case XML_END_TAG:
        throw new UnexpectedXMLEndTag();
      case EOI:
        throw new UnexpectedEndOfInput();
      default:
        elements.push(object);
        break;
    }
  }
  return new EVLVector(elements);
}

function readXMLElement(tokenizer) {
  const xmlStartTagName = tokenizer.value;
  loop: while (true) {
    const object = readObject(tokenizer);
    switch (object) {
      case DOT:
        throw new UnexpectedDot();
      case CLOSING_PARENTHESIS:
        throw new UnexpectedClosingParenthesis();
      case XML_END_TAG:
        const xmlEndTagName = tokenizer.value;
        if (xmlStartTagName === xmlEndTagName) {
          break loop;
        } else {
          throw new ReaderError('Unmatched XML tags.');
        }
      case EOI:
        throw new UnexpectedEndOfInput();
      default:
        const callback = tokenizer.callback;
        if (callback !== undefined) {
          callback(object);
        }
        break;
    }
  }
}

/************************/
/* EVL to XML Converter */
/************************/

const XML_TOKEN = 100;
const EVL_TOKEN = 101;
const EOL_COMMENT = 102;

const XML_CONTEXT = 0;
const EVL_CONTEXT = 1;

function doConvertEVLToXML(tokenizer) {
  let xml = '';
  const contextStack = [];
  let previousToken = BOI;
  let context = contextStack[contextStack.length - 1];
  let token = null;
  while ((token = sketchyRead(tokenizer, contextStack)) !== EOI) {
    if (context === XML_CONTEXT) {
      xml += convertXMLWhitespace(previousToken, tokenizer.whitespace, token);
    } else if (context = EVL_CONTEXT) {
      xml += convertEVLWhitespace(previousToken, tokenizer.whitespace, token);
    } else { // top-level context
      xml += tokenizer.whitespace;
    }
    if (token === EVL_TOKEN) {
      xml += xmlEscape(tokenizer.lexeme);
    } else { // XML_TOKEN or EOL_COMMENT
      xml += tokenizer.lexeme;
    }
    previousToken = token;
    context = contextStack[contextStack.length - 1];
  }
  xml += tokenizer.whitespace;
  return xml;
}

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

function sketchyRead(tokenizer, contextStack) {
  tokenizer.nextToken();
  switch (tokenizer.category) {
    case VOID:
    case BOOLEAN:
    case NUMBER:
    case CHARACTER: // full hash-string construct
    case STRING:
    case KEYWORD:
    case VARIABLE:
    case QUOTE:
    case QUASIQUOTE:
    case UNQUOTE:
    case UNQUOTE_SPLICING:
    case HASH_PLUS:
    case HASH_MINUS:
    case DOT:
      return EVL_TOKEN;
    case OPENING_PARENTHESIS:
    case HASH_OPENING_PARENTHESIS:
      contextStack.push(EVL_CONTEXT);
      return EVL_TOKEN;
    case CLOSING_PARENTHESIS:
      if (contextStack[contextStack.length - 1] !== EVL_CONTEXT) {
        throw new EVLToXMLConverterError('Unexpected closing parenthesis.');
      }
      contextStack.pop();
      return EVL_TOKEN;
    case XML_START_TAG:
      if (tokenizer.value === 'comment') {
        readEndOfLineComment(tokenizer);
        return EOL_COMMENT;
      } else {
        contextStack.push(XML_CONTEXT);
        return XML_TOKEN;
      }
    case XML_END_TAG:
      if (contextStack[contextStack.length - 1] !== XML_CONTEXT) {
        throw new EVLToXMLConverterError('Unexpected XML end tag.');
      }
      contextStack.pop();
      return XML_TOKEN;
    case XML_EMPTY_ELEMENT_TAG:
    case XML_COMMENT:
      return XML_TOKEN;
    case EOI:
      if (contextStack.length !== 0) {
        throw new EVLToXMLConverterError('Unexpected end-of-input.');
      }
      return EOI;
    default:
      throw new CannotHappen('sketchyRead');
  }
}

function readEndOfLineComment(tokenizer) {
  const whitespace = tokenizer.whitespace;
  let lexeme = tokenizer.lexeme;
  const contextStack = [];
  while (true) {
    tokenizer.nextToken();
    switch (tokenizer.category) {
      case XML_START_TAG:
        lexeme += tokenizer.whitespace;
        lexeme += tokenizer.lexeme;
        contextStack.push(XML_CONTEXT);
        break;
      case XML_END_TAG:
        lexeme += tokenizer.whitespace;
        lexeme += tokenizer.lexeme;
        if (contextStack.length === 0) {
          tokenizer.whitespace = whitespace; // run of whitespace before end-of-line comment
          tokenizer.lexeme = lexeme; // end-of-line comment
          return;
        } else {
          contextStack.pop();
          break;
        }
      case XML_EMPTY_ELEMENT_TAG:
      case XML_COMMENT:
        lexeme += tokenizer.whitespace;
        lexeme += tokenizer.lexeme;
        break;
      case EOI:
        throw new EVLToXMLConverterError('Unexpected end-of-input.');
      default:
        throw new CannotHappen('readEndOfLineComment');
    }
  }
}

function isXMLToken(token) {
  return token === XML_TOKEN;
}

function isEVLToken(token) {
  return token === EVL_TOKEN || token === EOL_COMMENT;
}

function convertXMLWhitespace(previousToken, whitespace, token) {
  let xml = '';
  if (isXMLToken(previousToken) && isEVLToken(token)) {
    xml += whitespace;
    xml += '<toplevelcode><blockcode>';
  } else if (isEVLToken(previousToken) && isEVLToken(token)) {
    if (countNewlines(whitespace) >= 2) {
      xml += '</blockcode></toplevelcode>';
      xml += whitespace;
      xml += '<toplevelcode><blockcode>';
    } else {
      xml += whitespace;
    }
  } else if (isEVLToken(previousToken) && isXMLToken(token)) {
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

function convertEVLWhitespace(previousToken, whitespace, token) {
  let xml = '';
  if (isEVLToken(previousToken) && isXMLToken(token)) {
    xml += '</blockcode><indentation style="margin-left: ';
    xml += countSpacesAfterFirstNewline(whitespace);
    xml += 'ch;"><blockcomment>';
    xml += whitespace;
  } else if (isXMLToken(previousToken) && isEVLToken(token)) {
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

/*****************/
/* Form Analyzer */
/*****************/

function formAnalyzerError(formName) {
  throw new FormAnalyzerError(`Malformed ${formName} form.`);
}

function checkVariable(object, formName) {
  if (object instanceof EVLVariable) {
    return object;
  } else {
    formAnalyzerError(formName);
  }
}

function checkEmptyList(object, formName) {
  if (object instanceof EVLEmptyList) {
    return object;
  } else {
    formAnalyzerError(formName);
  }
}

function checkCons(object, formName) {
  if (object instanceof EVLCons) {
    return object;
  } else {
    formAnalyzerError(formName);
  }
}

function checkProperList(object, formName) {
  let list = object;
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      list = list.cdr;
    } else {
      formAnalyzerError(formName);
    }
  }
  return object;
}

function checkParameterList(object, formName) {
  if (object instanceof EVLVariable) {
    return [[object], true];
  } else {
    const parameters = [];
    let rest = false;
    let list = object
    while (list !== EVLEmptyList.NIL) {
      if (list instanceof EVLCons) {
        if (list.car instanceof EVLVariable) {
          parameters.push(list.car);
        } else {
          formAnalyzerError(formName);
        }
        if (list.cdr instanceof EVLVariable) {
          parameters.push(list.cdr);
          rest = true;
          break;
        } else {
          list = list.cdr;
        }
      } else {
        formAnalyzerError(formName);
      }
    }
    if (new Set(parameters).size !== parameters.length) {
      formAnalyzerError(formName);
    }
    return [parameters, rest];
  }
}

function analyzeQuote(form) {
  let cons = form;
  cons = checkCons(cons.cdr, 'quote');
  const literal = cons.car;
  checkEmptyList(cons.cdr, 'quote');
  return [literal];
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
  const [parameters, rest] = checkParameterList(cons.car, '_lambda');
  const forms = checkProperList(cons.cdr, '_lambda');
  return [parameters, rest, forms];
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

function analyzeCall(mv, apply, form) {
  let cons = form;
  if (mv || apply) {
    cons = checkCons(cons.cdr, 'call');
  }
  const operator = cons.car;
  const operands = checkProperList(cons.cdr, 'call');
  return [operator, operands];
}

/*****************************/
/* Scope-Extent Combinations */
/*****************************/

const LEX_SCOPE = 0; // lexical scope and indefinite extent
const DYN_SCOPE = 1; // indefinite scope and dynamic extent

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
          throw new UnboundVariable(variable, 'value');
        }
      }
      case FUN_NS: {
        const value = variable.function;
        if (value !== null) {
          return value;
        } else {
          throw new UnboundVariable(variable, 'function');
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

/************************************/
/* Lexical and Dynamic Environments */
/************************************/

class DefiniteEnv { // abstract class
}

class NullDefiniteEnv extends DefiniteEnv {
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

const nullDefiniteEnv = new NullDefiniteEnv();

class Frame extends DefiniteEnv {
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

/*************************************/
/* Pairing Parameters with Arguments */
/*************************************/

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

class MalformedSpreadableSequenceOfObjects extends EvaluatorError {
  constructor() {
    super('Malformed spreadable sequence of objects.');
    this.name = 'MalformedSpreadableSequenceOfObjects';
  }
}

function pairPrimFunParameters(apply, args, arityMin, arityMax) {
  if (!apply) {
    return pairPrimFunParametersNoApply(args, arityMin, arityMax);
  } else {
    return pairPrimFunParametersApply(args, arityMin, arityMax);
  }
}

function pairPrimFunParametersNoApply(args, arityMin, arityMax) {
  const nargs = args.length;
  if (nargs < arityMin) {
    throw new TooFewArguments();
  }
  if (arityMax !== null && nargs > arityMax) {
    throw new TooManyArguments();
  }
  return args;
}

function pairPrimFunParametersApply(args, arityMin, arityMax) {
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
    throw new MalformedSpreadableSequenceOfObjects();
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
      throw new MalformedSpreadableSequenceOfObjects();
    }
  }
  if (i < arityMin) {
    throw new TooFewArguments();
  }
  return spreadArgs;
}

function pairClosureParameters(apply, args, parameters, rest) {
  if (!apply) {
    if (!rest) {
      return pairClosureParametersNoApplyNoRest(args, parameters);
    } else {
      return pairClosureParametersNoApplyRest(args, parameters);
    }
  } else {
    if (!rest) {
      return pairClosureParametersApplyNoRest(args, parameters);
    } else {
      return pairClosureParametersApplyRest(args, parameters);
    }
  }
}

function pairClosureParametersNoApplyNoRest(args, parameters) {
  const nargs = args.length;
  const nparameters = parameters.length;
  if (nargs < nparameters) {
    throw new TooFewArguments();
  }
  if (nargs > nparameters) {
    throw new TooManyArguments();
  }
  return args;
}

function pairClosureParametersNoApplyRest(args, parameters) {
  const nargs = args.length;
  const nparameters = parameters.length;
  const values = new Array(nparameters);
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  let i = 0;
  while (i < nargs) {
    if (i < nparameters - 1) {
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
  if (i < nparameters - 1) {
    throw new TooFewArguments();
  }
  values[nparameters - 1] = list;
  return values;
}

function pairClosureParametersApplyNoRest(args, parameters) {
  const nargs = args.length;
  const nparameters = parameters.length;
  const values = new Array(nparameters);
  let i = 0;
  while (i < nargs - 1) {
    if (i < nparameters) {
      values[i] = args[i];
      i++;
    } else {
      throw new TooManyArguments();
    }
  }
  if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
    throw new MalformedSpreadableSequenceOfObjects();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (i < nparameters) {
        values[i] = argList.car;
        i++;
      } else {
        throw new TooManyArguments();
      }
      argList = argList.cdr;
    } else {
      throw new MalformedSpreadableSequenceOfObjects();
    }
  }
  if (i < nparameters) {
    throw new TooFewArguments();
  }
  return values;
}

function pairClosureParametersApplyRest(args, parameters) {
  const nargs = args.length;
  const nparameters = parameters.length;
  const values = new Array(nparameters);
  let list = EVLEmptyList.NIL;
  let lastCons = null;
  let i = 0;
  while (i < nargs - 1) {
    if (i < nparameters - 1) {
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
    throw new MalformedSpreadableSequenceOfObjects();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (i < nparameters - 1) {
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
      throw new MalformedSpreadableSequenceOfObjects();
    }
  }
  if (i < nparameters - 1) {
    throw new TooFewArguments();
  }
  values[nparameters - 1] = list;
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
  throw new EvaluatorError('The empty list does not evaluate.');
}

function ifTestFormError() {
  throw new EvaluatorError('The test-form does not evaluate to a boolean.');
}

function forEachNotImplemented() {
  throw new EvaluatorError('The _for-each-form is not implemented.');
}

function forEachFunctionFormError() {
  throw new EvaluatorError('The function-form does not evaluate to a function.');
}

function forEachListFormError() {
  throw new EvaluatorError('The list-form does not evaluate to a proper list.');
}

function callOperatorFormError() {
  throw new EvaluatorError('The operator-form does not evaluate to a function.');
}

/*****************************/
/* Plain Recursive Evaluator */
/*****************************/

function plainrecEval(form) {
  return plainrecEvalForm(form, nullDefiniteEnv, nullDefiniteEnv);
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
        return plainrecEvalCall(false, true, form, lenv, denv);
      case multipleValueCallVariable:
        return plainrecEvalCall(true, false, form, lenv, denv);
      case multipleValueApplyVariable:
        return plainrecEvalCall(true, true, form, lenv, denv);
      default:
        return plainrecEvalCall(false, false, form, lenv, denv);
    }
  } else if (form instanceof EVLVariable) {
    return lenv.ref(VAL_NS, form);
  } else {
    return form;
  }
}

function plainrecEvalQuote(form, lenv, denv) {
  const [literal] = analyzeQuote(form);
  return literal;
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
  const [parameters, rest, forms] = analyzeLambda(form);
  return new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv);
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

function plainrecEvalCall(mv, apply, form, lenv, denv) {
  const [operator, operands] = analyzeCall(mv, apply, form);
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        if (macro) {
          const expansion = plainrecEvalForms(fn.forms, elenv, denv).primaryValue();
          return plainrecEvalForm(expansion, lenv, denv);
        } else {
          return plainrecEvalForms(fn.forms, elenv, denv);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return plainrecEvalForms(fn.forms, fn.lenv, edenv);
      default:
        throw new CannotHappen('plainrecInvokeFun');
    }
  } else {
    callOperatorFormError();
  }
}

/****************************************/
/* Continuation Passing Style Evaluator */
/****************************************/

function cpsEval(form) {
  return cpsEvalForm(form, nullDefiniteEnv, nullDefiniteEnv, cpsEndCont);
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
        return cpsEvalCall(false, true, form, lenv, denv, k);
      case multipleValueCallVariable:
        return cpsEvalCall(true, false, form, lenv, denv, k);
      case multipleValueApplyVariable:
        return cpsEvalCall(true, true, form, lenv, denv, k);
      default:
        return cpsEvalCall(false, false, form, lenv, denv, k);
    }
  } else if (form instanceof EVLVariable) {
    return k(lenv.ref(VAL_NS, form));
  } else {
    return k(form);
  }
}

const cpsEndCont = result => result;

function cpsEvalQuote(form, lenv, denv, k) {
  const [literal] = analyzeQuote(form);
  return k(literal);
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
  const [parameters, rest, forms] = analyzeLambda(form);
  return k(new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv));
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

function cpsEvalCall(mv, apply, form, lenv, denv, k) {
  const [operator, operands] = analyzeCall(mv, apply, form);
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return k(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        if (macro) {
          const expansion = cpsEvalForms(fn.forms, elenv, denv, cpsEndCont).primaryValue();
          return cpsEvalForm(expansion, lenv, denv, k);
        } else {
          return cpsEvalForms(fn.forms, elenv, denv, k);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return cpsEvalForms(fn.forms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('cpsInvokeFun');
    }
  } else {
    callOperatorFormError();
  }
}

/*********************************/
/* Object-Oriented CPS Evaluator */
/*********************************/

function oocpsEval(form) {
  return oocpsEvalForm(form, nullDefiniteEnv, nullDefiniteEnv, oocpsEndCont);
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
        return oocpsEvalCall(false, true, form, lenv, denv, k);
      case multipleValueCallVariable:
        return oocpsEvalCall(true, false, form, lenv, denv, k);
      case multipleValueApplyVariable:
        return oocpsEvalCall(true, true, form, lenv, denv, k);
      default:
        return oocpsEvalCall(false, false, form, lenv, denv, k);
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
  const [literal] = analyzeQuote(form);
  return k.invoke(literal);
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
  const [parameters, rest, forms] = analyzeLambda(form);
  return k.invoke(new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv));
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

function oocpsEvalCall(mv, apply, form, lenv, denv, k) {
  const [operator, operands] = analyzeCall(mv, apply, form);
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return k.invoke(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        if (macro) {
          const expansion = oocpsEvalForms(fn.forms, elenv, denv, oocpsEndCont).primaryValue();
          return oocpsEvalForm(expansion, lenv, denv, k);
        } else {
          return oocpsEvalForms(fn.forms, elenv, denv, k);
        }
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return oocpsEvalForms(fn.forms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('oocpsInvokeFun');
    }
  } else {
    callOperatorFormError();
  }
}

/*********************************************/
/* Stack-Based Object-Oriented CPS Evaluator */
/*********************************************/

function sboocpsEval(form) {
  const kStack = new SBOOCPSControlStack();
  kStack.push(sboocpsEndCont);
  return sboocpsEvalForm(form, nullDefiniteEnv, kStack);
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
        return sboocpsEvalCall(false, true, form, lenv, kStack);
      case multipleValueCallVariable:
        return sboocpsEvalCall(true, false, form, lenv, kStack);
      case multipleValueApplyVariable:
        return sboocpsEvalCall(true, true, form, lenv, kStack);
      default:
        return sboocpsEvalCall(false, false, form, lenv, kStack);
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
  const [literal] = analyzeQuote(form);
  return kStack.invokeCont(literal);
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
  const [parameters, rest, forms] = analyzeLambda(form);
  return kStack.invokeCont(new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv));
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

function sboocpsEvalCall(mv, apply, form, lenv, kStack) {
  const [operator, operands] = analyzeCall(mv, apply, form);
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return kStack.invokeCont(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        if (macro) {
          kStack.push(sboocpsEndCont);
          const expansion = sboocpsEvalForms(fn.forms, elenv, kStack).primaryValue();
          return sboocpsEvalForm(expansion, lenv, kStack);
        } else {
          return sboocpsEvalForms(fn.forms, elenv, kStack);
        }
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.parameters, values, undefined));
        return sboocpsEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('sboocpsInvokeFun');
    }
  } else {
    callOperatorFormError();
  }
}

/************************/
/* Trampoline Evaluator */
/************************/

function trampolineEval(form) {
  const kStack = new TrampolineControlStack();
  kStack.push(trampolineEndCont);
  let bounce = new EvalReq(form, nullDefiniteEnv);
  while (true) {
    if (abortSignalArray !== null && abortSignalArray[0] === 1) {
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
        return trampolineEvalCall(false, true, form, lenv, kStack);
      case multipleValueCallVariable:
        return trampolineEvalCall(true, false, form, lenv, kStack);
      case multipleValueApplyVariable:
        return trampolineEvalCall(true, true, form, lenv, kStack);
      default:
        return trampolineEvalCall(false, false, form, lenv, kStack);
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
  const [literal] = analyzeQuote(form);
  return literal;
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
  const [parameters, rest, forms] = analyzeLambda(form);
  return new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv);
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

function trampolineEvalCall(mv, apply, form, lenv, kStack) {
  const [operator, operands] = analyzeCall(mv, apply, form);
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        if (macro) {
          kStack.push(new TrampolineMacroCont(lenv, kStack));
        }
        return trampolineEvalForms(fn.forms, elenv, kStack);
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.parameters, values, undefined));
        return trampolineEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('trampolineInvokeFun');
    }
  } else {
    callOperatorFormError();
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
    form = trampolineppPreprocessForm(form, nullDefiniteEnv);
    lenv = nullDefiniteEnv;
  }
  const kStack = new TrampolineppControlStack();
  kStack.push(trampolineppEndCont);
  let bounce = new EvalReq(form, lenv);
  while (true) {
    if (abortSignalArray !== null && abortSignalArray[0] === 1) {
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
        return trampolineppPreprocessCall(false, true, form, lenv);
      case multipleValueCallVariable:
        return trampolineppPreprocessCall(true, false, form, lenv);
      case multipleValueApplyVariable:
        return trampolineppPreprocessCall(true, true, form, lenv);
      default:
        return trampolineppPreprocessCall(false, false, form, lenv);
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
  const [literal] = analyzeQuote(form);
  return new TrampolineppQuote(literal);
}

class TrampolineppQuote extends TrampolineppForm {
  constructor(literal) {
    super();
    this.literal = literal;
  }
  eval(lenv, kStack) {
    const {literal} = this;
    return literal;
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
  const [parameters, rest, forms] = analyzeLambda(form);
  switch (scope) {
    case LEX_SCOPE: {
      const elenv = new Frame(namespace, parameters, new Array(parameters.length).fill(null), lenv);
      const preprocessedForms = trampolineppPreprocessForms(forms, elenv);
      return new TrampolineppLambda(scope, namespace, macro, parameters, rest, preprocessedForms);
    }
    case DYN_SCOPE: {
      const preprocessedForms = trampolineppPreprocessForms(forms, lenv);
      return new TrampolineppLambda(scope, namespace, macro, parameters, rest, preprocessedForms);
    }
    default:
      throw new CannotHappen('trampolineppPreprocessLambda');
  }
}

class TrampolineppLambda extends TrampolineppForm {
  constructor(scope, namespace, macro, parameters, rest, forms) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.parameters = parameters;
    this.rest = rest;
    this.forms = forms;
  }
  eval(lenv, kStack) {
    const {scope, namespace, macro, parameters, rest, forms} = this;
    return new EVLClosure(scope, namespace, macro, parameters, rest, forms, lenv);
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

function trampolineppPreprocessCall(mv, apply, form, lenv) {
  const [operator, operands] = analyzeCall(mv, apply, form);
  if (operator instanceof EVLVariable) {
    const [i, j, fn] = lenv.preprocessorRef(FUN_NS, operator, 0);
    if (fn instanceof EVLClosure && fn.macro) {
      const values = pairClosureParameters(false, listToArray(operands), fn.parameters, fn.rest);
      const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
      const expansion = trampolineppEval(new TrampolineppProgn(fn.forms), elenv).primaryValue();
      return trampolineppPreprocessForm(expansion, lenv);
    } else {
      const preprocessedOperator = trampolineppPreprocessRef2(LEX_SCOPE, FUN_NS, operator, lenv);
      const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
      return new TrampolineppCall(mv, apply, preprocessedOperator, preprocessedOperands);
    }
  } else if (isMacroLet(operator, operands)) {
    const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
    const [parameters, rest, forms] = analyzeLambda(operator);
    const values = listToArray(preprocessedOperands).map(preprocessedOperand => preprocessedOperand.eval(nullDefiniteEnv, null));
    const elenv = new Frame(FUN_NS, parameters, values, lenv);
    const preprocessedForms = trampolineppPreprocessForms(forms, elenv);
    const preprocessedOperator = new TrampolineppLambda(LEX_SCOPE, FUN_NS, false, parameters, rest, preprocessedForms);
    return new TrampolineppCall(mv, apply, preprocessedOperator, preprocessedOperands);
  } else {
    const preprocessedOperator = trampolineppPreprocessForm(operator, lenv);
    const preprocessedOperands = trampolineppPreprocessForms(operands, lenv);
    return new TrampolineppCall(mv, apply, preprocessedOperator, preprocessedOperands);
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

class TrampolineppCall extends TrampolineppForm {
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
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return trampolineppEvalForms(fn.forms, elenv, kStack);
      case DYN_SCOPE:
        kStack.push(new Frame(fn.namespace, fn.parameters, values, undefined));
        return trampolineppEvalForms(fn.forms, fn.lenv, kStack);
      default:
        throw new CannotHappen('trampolineppInvokeFun');
    }
  } else {
    callOperatorFormError();
  }
}

/**************************************/
/* Primitive Function Definitions (1) */
/**************************************/

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

// the only object of type void
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
    this.jsValue = jsValue; // JavaScript boolean
  }
  toString() {
    return this.jsValue ? '#t' : '#f';
  }
}

// the only object of type boolean representing true
EVLBoolean.TRUE = new EVLBoolean(true);
// the only object of type boolean representing false
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
    this.jsValue = jsValue; // JavaScript number
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
    this.jsValue = jsValue; // JavaScript string of one UTF-16 code unit
  }
  eql(that) {
    if (that instanceof EVLCharacter) {
      return this.jsValue === that.jsValue;
    } else {
      return false;
    }
  }
  toString() {
    return '#"' + escapeCharacters(this.jsValue, escapeStringCharacter) + '"';
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
    this.jsValue = jsValue; // JavaScript string
  }
  eql(that) {
    if (that instanceof EVLString) {
      return this.jsValue === that.jsValue;
    } else {
      return false;
    }
  }
  toString() {
    return '"' + escapeCharacters(this.jsValue, escapeStringCharacter) + '"';
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
    this.name = name; // JavaScript string
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
  toString() {
    return ':' + escapeCharacters(this.name, escapeProtoTokenCharacter);
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
    this.value = null; // EVLObject or null
    this.function = null; // EVLObject or null
  }
  toString() {
    return escapeCharacters(this.name, escapeProtoTokenCharacter);
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
const mlambdaVariable = internVariable('mlambda'); // mlet
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

// the only object of type empty-list
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
    this.elements = elements; // JavaScript array of EVLObject's and/or null's
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
    this.jsFunction = jsFunction; // JavaScript function
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
  constructor(scope, namespace, macro, parameters, rest, forms, lenv) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.parameters = parameters;
    this.rest = rest;
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

/*************************************/
/* Miscellaneous Primitive Functions */
/*************************************/

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

/**************************************/
/* Primitive Function Definitions (2) */
/**************************************/

for (const [name, [arityMin, arityMax, jsFunction]] of primitiveFunctions) {
  GlobalEnv.set(FUN_NS, internVariable(name), new EVLPrimitiveFunction(arityMin, arityMax, jsFunction));
}

/****************************/
/* Interface (Command Line) */
/****************************/

const evaluatorOptions = [
  '--plainrec',
  '--cps',
  '--oocps',
  '--sboocps',
  '--trampoline',
  '--trampolinepp'
];

if (isRunningInsideNode) {
  import('node:fs').then(fs => {
    const nargs = process.argv.length;
    let n = 2; // skip 'node' and 'core.js'
    selectedEvaluator = 'trampolinepp';
    if (n < nargs && evaluatorOptions.includes(process.argv[n])) {
      selectedEvaluator = process.argv[n++].substring(2);
    }
    initializeFeatureList([selectedEvaluator]);
    while (n < nargs) {
      const arg = process.argv[n++];
      switch (arg) {
        case '-l': {
          if (n === nargs) {
            usage();
          }
          const file = process.argv[n++];
          const fileContents = fs.readFileSync(file, 'utf8');
          printToConsole(evaluateAllForms(fileContents));
          break;
        }
        case '-e': {
          if (n === nargs) {
            usage();
          }
          const form = process.argv[n++];
          printToConsole(evaluateFirstForm(form));
          break;
        }
        case '--convert': {
          if (n === nargs) {
            usage();
          }
          const file = process.argv[n++];
          const fileContents = fs.readFileSync(file, 'utf8');
          printToConsole(convertEVLToXML(fileContents));
          break;
        }
        default:
          usage();
      }
    }
  });
}

function usage() {
  console.log('usage:');
  console.log('--plainrec: selects the plain recursive evaluator');
  console.log('--cps: selects the continuation passing style evaluator');
  console.log('--oocps: selects the object-oriented CPS evaluator');
  console.log('--sboocps: selects the stack-based object-oriented CPS evaluator');
  console.log('--trampoline: selects the trampoline evaluator');
  console.log('--trampolinepp: selects the trampoline++ evaluator (DEFAULT)');
  console.log('-l <file>: loads the EVL file');
  console.log('-e <form>: evaluates the form');
  console.log('--convert <file>: converts the EVL file to XML');
  process.exit();
}

function printToConsole(response) {
  switch (response.status) {
    case SUCCESS:
      console.log(response.output);
      break;
    case ERROR:
      console.log(response.output);
      process.exit();
  }
}
