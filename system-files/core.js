// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

/********************/
/* Global Variables */
/********************/

const isRunningInsideNode = (typeof process !== 'undefined') && (process.release.name === 'node');

let abortSignalArray = null;
let selectedEvaluator = null;

const optimizeMacroCalls = true;

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
    return {status: ERROR, output: exception.name + ': ' + exception.message};
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

function checkVariable(object, formName) {
  if (object instanceof EVLVariable) {
    return object;
  } else {
    return new MalformedForm(formName);
  }
}

function checkEmptyList(object, formName) {
  if (object instanceof EVLEmptyList) {
    return object;
  } else {
    return new MalformedForm(formName);
  }
}

function checkCons(object, formName) {
  if (object instanceof EVLCons) {
    return object;
  } else {
    return new MalformedForm(formName);
  }
}

function checkProperList(object, formName) {
  let list = object;
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      list = list.cdr;
    } else {
      return new MalformedForm(formName);
    }
  }
  return object;
}

function isProperList(object) {
  let list = object;
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      list = list.cdr;
    } else {
      return false;
    }
  }
  return true;
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
          return new MalformedForm(formName);
        }
        if (list.cdr instanceof EVLVariable) {
          parameters.push(list.cdr);
          rest = true;
          break;
        } else {
          list = list.cdr;
        }
      } else {
        return new MalformedForm(formName);
      }
    }
    if (new Set(parameters).size !== parameters.length) {
      return new MalformedForm(formName);
    }
    return [parameters, rest];
  }
}

function analyzeQuote(form) {
  const formName = 'quote form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const literal = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [literal];
}

function analyzeProgn(form) {
  const formName = 'progn form';
  let cons = form;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [serialForms];
}

function analyzeIf(form) {
  const formName = 'if form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const testForm = cons.car;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const thenForm = cons.car;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const elseForm = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [testForm, thenForm, elseForm];
}

function analyzeForEach(form) {
  const formName = '_for-each form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const functionForm = cons.car;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const listForm = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [functionForm, listForm];
}

function analyzeLambda(form) {
  const formName = 'lambda abstraction';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const parameterList = checkParameterList(cons.car, formName);
  if (isError(parameterList)) return parameterList;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [parameterList[0], parameterList[1], serialForms];
}

function analyzeRef(form) {
  const formName = 'variable reference';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const variable = checkVariable(cons.car, formName);
  if (isError(variable)) return variable;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [variable];
}

function analyzeSet(form) {
  const formName = 'variable assignment';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const variable = checkVariable(cons.car, formName);
  if (isError(variable)) return variable;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const valueForm = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [variable, valueForm];
}

function analyzeBlock(form) {
  const formName = 'block form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const blockName = checkVariable(cons.car, formName);
  if (isError(blockName)) return blockName;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [blockName, serialForms];
}

function analyzeReturnFrom(form) {
  const formName = 'return-from form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const blockName = checkVariable(cons.car, formName);
  if (isError(blockName)) return blockName;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const valuesForm = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [blockName, valuesForm];
}

function analyzeCatch(form) {
  const formName = 'catch form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const exitTagForm = cons.car;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [exitTagForm, serialForms];
}

function analyzeThrow(form) {
  const formName = 'throw form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const exitTagForm = cons.car;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const valuesForm = cons.car;
  const emptyList = checkEmptyList(cons.cdr, formName);
  if (isError(emptyList)) return emptyList;
  return [exitTagForm, valuesForm];
}

function analyzeHandlerBind(form) {
  const formName = '_handler-bind form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const handlerForm = cons.car;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [handlerForm, serialForms];
}

function analyzeUnwindProtect(form) {
  const formName = 'unwind-protect form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const protectedForm = cons.car;
  const cleanupForms = checkProperList(cons.cdr, formName);
  if (isError(cleanupForms)) return cleanupForms;
  return [protectedForm, cleanupForms];
}

function analyzeMlet(form) {
  // (mlet ((variable parameter-list . serial-forms)*) . serial-forms)
  const formName = 'mlet form';
  let cons = form;
  cons = checkCons(cons.cdr, formName);
  if (isError(cons)) return cons;
  const mletBindings = checkMletBindings(cons.car, formName);
  if (isError(mletBindings)) return mletBindings;
  const serialForms = checkProperList(cons.cdr, formName);
  if (isError(serialForms)) return serialForms;
  return [mletBindings, serialForms];
}

function checkMletBindings(list, formName) {
  const mletBindings = [];
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      let cons = checkCons(list.car, formName);
      if (isError(cons)) return cons;
      const variable = checkVariable(cons.car, formName);
      if (isError(variable)) return variable;
      cons = checkCons(cons.cdr, formName);
      if (isError(cons)) return cons;
      const parameterList = checkProperList(cons.car, formName);
      if (isError(parameterList)) return parameterList;
      const serialForms = checkProperList(cons.cdr, formName);
      if (isError(serialForms)) return serialForms;
      mletBindings.push([variable, parameterList, serialForms]);
      list = list.cdr;
    } else {
      return new MalformedForm(formName);
    }
  }
  return mletBindings;
}

function analyzeCall(mv, apply, form, lenv) {
  const formName = 'call';
  let cons = form;
  if (mv || apply) {
    cons = checkCons(cons.cdr, formName);
    if (isError(cons)) return cons;
  }
  const operator = cons.car;
  const operands = checkProperList(cons.cdr, formName);
  if (isError(operands)) return operands;
  if (mv || apply || !(operator instanceof EVLVariable)) {
    return [false, operator, operands];
  } else {
    const fn = lenv.ref(FUN_NS, operator);
    if (fn instanceof EVLClosure && fn.macro) {
      return [true, fn, operands];
    } else {
      return [false, operator, operands];
    }
  }
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
const BLK_NS = 2; // block namespace
const XIT_NS = 3; // exit-point namespace

/**********************/
/* Global Environment */
/**********************/

class GlobalEnv {
  static ref(namespace, variable) {
    switch (namespace) {
      case VAL_NS: {
        const value = variable.value;
        if (value !== null) {
          return value;
        } else {
          return new UnboundVariable(variable, 'value');
        }
      }
      case FUN_NS: {
        const value = variable.function;
        if (value !== null) {
          return value;
        } else {
          return new UnboundVariable(variable, 'function');
        }
      }
      case BLK_NS:
      case XIT_NS:
        return null;
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
  lookup(namespace, variable, i) {
    return [true, null, null];
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
    return this.next.ref(namespace, variable);
  }
  set(namespace, variable, value) {
    if (this.namespace === namespace) {
      for (let j = 0; j < this.variables.length; j++) {
        if (this.variables[j] === variable) {
          return this.values[j] = value;
        }
      }
    }
    return this.next.set(namespace, variable, value);
  }
  lookup(namespace, variable, i) {
    if (this.namespace === namespace) {
      for (let j = 0; j < this.variables.length; j++) {
        if (this.variables[j] === variable) {
          return [false, i, j];
        }
      }
    }
    return this.next.lookup(namespace, variable, i + 1);
  }
}

/*************************************/
/* Pairing Parameters with Arguments */
/*************************************/

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
    return new TooFewArguments();
  }
  if (arityMax !== null && nargs > arityMax) {
    return new TooManyArguments();
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
      return new TooManyArguments();
    }
  }
  if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
    return new SpreadError();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (arityMax === null || i < arityMax) {
        spreadArgs.push(argList.car);
        i++;
      } else {
        return new TooManyArguments();
      }
      argList = argList.cdr;
    } else {
      return new SpreadError();
    }
  }
  if (i < arityMin) {
    return new TooFewArguments();
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
    return new TooFewArguments();
  }
  if (nargs > nparameters) {
    return new TooManyArguments();
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
    return new TooFewArguments();
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
      return new TooManyArguments();
    }
  }
  if (nargs === 0 || !(args[nargs - 1] instanceof EVLList)) {
    return new SpreadError();
  }
  let argList = args[nargs - 1];
  while (argList !== EVLEmptyList.NIL) {
    if (argList instanceof EVLCons) {
      if (i < nparameters) {
        values[i] = argList.car;
        i++;
      } else {
        return new TooManyArguments();
      }
      argList = argList.cdr;
    } else {
      return new SpreadError();
    }
  }
  if (i < nparameters) {
    return new TooFewArguments();
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
    return new SpreadError();
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
      return new SpreadError();
    }
  }
  if (i < nparameters - 1) {
    return new TooFewArguments();
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
  let outcome = null;
  switch(selectedEvaluator) {
    case 'directstyle':
      outcome = directstyleEval(form);
      break;
    case 'cps':
      outcome = cpsEval(form);
      break;
    case 'oocps':
      outcome = oocpsEval(form);
      break;
    case 'sboocps':
      outcome = sboocpsEval(form);
      break;
    case 'trampoline':
      outcome = trampolineEval(form);
      break;
    case 'trampolinepp':
      outcome = trampolineppEval(form);
      break;
    default:
      throw new CannotHappen('genericEval');
  }
  if (isNonlocalExit(outcome)) {
    outcome = new RunawayNonlocalExit();
  }
  if (isNormalCompletion(outcome)) {
    return outcome;
  } else if (isError(outcome)) {
    throw new EvaluatorError(outcome.category.jsValue + ': ' + outcome.description.jsValue);
  } else {
    throw new CannotHappen('genericEval');
  }
}

function alterForm(form, newForm) {
  if (newForm instanceof EVLCons) {
    form.car = newForm.car;
    form.cdr = newForm.cdr;
  } else {
    form.car = prognVariable;
    form.cdr = new EVLCons(newForm, EVLEmptyList.NIL);
  }
}

/**************************/
/* Direct Style Evaluator */
/**************************/

function directstyleEval(form) {
  return directstyleEvalForm(form, nullDefiniteEnv, nullDefiniteEnv);
}

function directstyleEvalForm(form, lenv, denv) {
  if (form instanceof EVLEmptyList) {
    return new EmptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return directstyleEvalQuote(form, lenv, denv);
      case prognVariable:
        return directstyleEvalProgn(form, lenv, denv);
      case ifVariable:
        return directstyleEvalIf(form, lenv, denv);
      case _forEachVariable:
        return directstyleEvalForEach(form, lenv, denv);
      case _vlambdaVariable:
        return directstyleEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv, denv);
      case _mlambdaVariable:
        return directstyleEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv, denv);
      case _flambdaVariable:
        return directstyleEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv, denv);
      case _dlambdaVariable:
        return directstyleEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv, denv);
      case vrefVariable:
        return directstyleEvalRef(LEX_SCOPE, VAL_NS, form, lenv, denv);
      case vsetVariable:
        return directstyleEvalSet(LEX_SCOPE, VAL_NS, form, lenv, denv);
      case frefVariable:
        return directstyleEvalRef(LEX_SCOPE, FUN_NS, form, lenv, denv);
      case fsetVariable:
        return directstyleEvalSet(LEX_SCOPE, FUN_NS, form, lenv, denv);
      case drefVariable:
        return directstyleEvalRef(DYN_SCOPE, VAL_NS, form, lenv, denv);
      case dsetVariable:
        return directstyleEvalSet(DYN_SCOPE, VAL_NS, form, lenv, denv);
      case blockVariable:
        return directstyleEvalBlock(form, lenv, denv);
      case returnFromVariable:
        return directstyleEvalReturnFrom(form, lenv, denv);
      case catchVariable:
        return directstyleEvalCatch(form, lenv, denv);
      case throwVariable:
        return directstyleEvalThrow(form, lenv, denv);
      case _handlerBindVariable:
        return directstyleEvalHandlerBind(form, lenv, denv);
      case unwindProtectVariable:
        return directstyleEvalUnwindProtect(form, lenv, denv);
      case applyVariable:
        return directstyleEvalCall(false, true, form, lenv, denv);
      case multipleValueCallVariable:
        return directstyleEvalCall(true, false, form, lenv, denv);
      case multipleValueApplyVariable:
        return directstyleEvalCall(true, true, form, lenv, denv);
      default:
        return directstyleEvalCall(false, false, form, lenv, denv);
    }
  } else if (form instanceof EVLVariable) {
    return lenv.ref(VAL_NS, form);
  } else {
    return form;
  }
}

function directstyleEvalQuote(form, lenv, denv) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return analysis;
  const [literal] = analysis;
  return literal;
}

function directstyleEvalProgn(form, lenv, denv) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return analysis;
  const [serialForms] = analysis;
  return directstyleEvalSerialForms(serialForms, lenv, denv);
}

function directstyleEvalSerialForms(serialForms, lenv, denv) {
  if (serialForms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else {
    return directstyleEvalSerialFormForms(serialForms, lenv, denv);
  }
}

function directstyleEvalSerialFormForms(serialForms, lenv, denv) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return directstyleEvalForm(serialForms.car, lenv, denv);
  } else {
    const outcome = directstyleEvalForm(serialForms.car, lenv, denv);
    if (isAbruptCompletion(outcome)) return outcome;
    return directstyleEvalSerialFormForms(serialForms.cdr, lenv, denv);
  }
}

function directstyleEvalIf(form, lenv, denv) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return analysis;
  const [testForm, thenForm, elseForm] = analysis;
  const outcome = directstyleEvalForm(testForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const test = outcome.primaryValue();
  switch (test) {
    case EVLBoolean.TRUE:
      return directstyleEvalForm(thenForm, lenv, denv);
    case EVLBoolean.FALSE:
      return directstyleEvalForm(elseForm, lenv, denv);
    default:
      return new TestFormTypeError();
  }
}

function directstyleEvalForEach(form, lenv, denv) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return analysis;
  const [functionForm, listForm] = analysis;
  const outcome = directstyleEvalForm(functionForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const fn = outcome.primaryValue();
  if (!(fn instanceof EVLFunction)) {
    return new FunctionFormTypeError();
  }
  const outcome2 = directstyleEvalForm(listForm, lenv, denv);
  if (isAbruptCompletion(outcome2)) return outcome2;
  const list = outcome2.primaryValue();
  if (!isProperList(list)) {
    return new ListFormTypeError();
  }
  return directstyleForEach(fn, list, denv);
}

function directstyleForEach(fn, list, denv) {
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      const outcome = directstyleInvoke(false, fn, [list.car], denv);
      if (isAbruptCompletion(outcome)) return outcome;
      list = list.cdr;
    } else {
      throw new CannotHappen('directstyleForEach'); // list is a proper list
    }
  }
  return EVLVoid.VOID;
}

function directstyleEvalLambda(scope, namespace, macro, form, lenv, denv) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return analysis;
  const [parameters, rest, serialForms] = analysis;
  return new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv);
}

function directstyleEvalRef(scope, namespace, form, lenv, denv) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return analysis;
  const [variable] = analysis;
  switch (scope) {
    case LEX_SCOPE:
      return lenv.ref(namespace, variable);
    case DYN_SCOPE:
      return denv.ref(namespace, variable);
    default:
      throw new CannotHappen('directstyleEvalRef');
  }
}

function directstyleEvalSet(scope, namespace, form, lenv, denv) {
  const analysis = analyzeSet(form);
  if (isError(analysis)) return analysis;
  const [variable, valueForm] = analysis;
  const outcome = directstyleEvalForm(valueForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const value = outcome.primaryValue();
  switch (scope) {
    case LEX_SCOPE:
      return lenv.set(namespace, variable, value);
    case DYN_SCOPE:
      return denv.set(namespace, variable, value);
    default:
      throw new CannotHappen('directstyleEvalSet');
  }
}

function directstyleEvalBlock(form, lenv, denv) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return analysis;
  const [blockName, serialForms] = analysis;
  const exitTag = new EVLVariable('exit-tag');
  const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
  const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
  const outcome = directstyleEvalSerialForms(serialForms, elenv, edenv);
  if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
    return outcome.values;
  } else {
    return outcome;
  }
}

function directstyleEvalReturnFrom(form, lenv, denv) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return analysis;
  const [blockName, valuesForm] = analysis;
  const exitTag = lenv.ref(BLK_NS, blockName);
  if (exitTag === null) {
    return new NoBlock(blockName);
  }
  const exitPoint = denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return new NoBlockExitPoint(blockName);
  }
  const outcome = directstyleEvalForm(valuesForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  return new NonlocalExit(exitTag, outcome);
}

function directstyleEvalCatch(form, lenv, denv) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, serialForms] = analysis;
  const outcome = directstyleEvalForm(exitTagForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const exitTag = outcome.primaryValue();
  if (!(exitTag instanceof EVLVariable)) {
    return new ExitTagFormTypeError();
  }
  const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
  const outcome2 = directstyleEvalSerialForms(serialForms, lenv, edenv);
  if (isNonlocalExit(outcome2) && outcome2.exitTag === exitTag) {
    return outcome2.values;
  } else {
    return outcome2;
  }
}

function directstyleEvalThrow(form, lenv, denv) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, valuesForm] = analysis;
  const outcome = directstyleEvalForm(exitTagForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const exitTag = outcome.primaryValue();
  if (!(exitTag instanceof EVLVariable)) {
    return new ExitTagFormTypeError();
  }
  const exitPoint = denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return new NoCatchExitPoint(exitTag);
  }
  const outcome2 = directstyleEvalForm(valuesForm, lenv, denv);
  if (isAbruptCompletion(outcome2)) return outcome2;
  return new NonlocalExit(exitTag, outcome2);
}

function directstyleEvalHandlerBind(form, lenv, denv) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return analysis;
  const [handlerForm, serialForms] = analysis;
  const outcome = directstyleEvalForm(handlerForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const handler = outcome.primaryValue();
  if (!(handler instanceof EVLFunction)) {
    return new HandlerFormTypeError();
  }
  const outcome2 = directstyleEvalSerialForms(serialForms, lenv, denv);
  if (isError(outcome2)) {
    const outcome3 = directstyleInvoke(false, handler, [outcome2.category, outcome2.description], denv);
    if (isAbruptCompletion(outcome3)) {
      return outcome3;
    } else {
      return outcome2;
    }
  } else {
    return outcome2;
  }
}

function directstyleEvalUnwindProtect(form, lenv, denv) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return analysis;
  const [protectedForm, cleanupForms] = analysis;
  const outcome = directstyleEvalForm(protectedForm, lenv, denv);
  const outcome2 = directstyleEvalSerialForms(cleanupForms, lenv, denv);
  if (isAbruptCompletion(outcome2)) {
    return outcome2;
  } else {
    return outcome;
  }
}

function directstyleEvalCall(mv, apply, form, lenv, denv) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return analysis;
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return directstyleEvalMacroCall(form, operator, operands, lenv, denv);
  } else {
    return directstyleEvalFunctionCall(mv, apply, operator, operands, lenv, denv);
  }
}

function directstyleEvalMacroCall(form, macro, macroOperands, lenv, denv) {
  const args = listToArray(macroOperands);
  const outcome = directstyleInvoke(false, macro, args, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const expansion = outcome.primaryValue();
  if (optimizeMacroCalls) {
    alterForm(form, expansion);
  }
  return directstyleEvalForm(expansion, lenv, denv);
}

function directstyleEvalFunctionCall(mv, apply, operatorForm, operandForms, lenv, denv) {
  const outcome = directstyleEvalOperatorForm(operatorForm, lenv, denv);
  if (isAbruptCompletion(outcome)) return outcome;
  const fn = outcome.primaryValue();
  if (!(fn instanceof EVLFunction)) {
    return new OperatorFormTypeError();
  }
  return directstyleEvalOperandForms(mv, apply, fn, operandForms, [], lenv, denv);
}

function directstyleEvalOperatorForm(operatorForm, lenv, denv) {
  if (operatorForm instanceof EVLVariable) {
    return lenv.ref(FUN_NS, operatorForm);
  } else {
    return directstyleEvalForm(operatorForm, lenv, denv);
  }
}

function directstyleEvalOperandForms(mv, apply, fn, operandForms, args, lenv, denv) {
  if (operandForms === EVLEmptyList.NIL) {
    return directstyleInvoke(apply, fn, args, denv);
  } else {
    const outcome = directstyleEvalForm(operandForms.car, lenv, denv);
    if (isAbruptCompletion(outcome)) return outcome;
    if (mv) {
      outcome.allValues().forEach(value => args.push(value));
    } else {
      args.push(outcome.primaryValue());
    }
    return directstyleEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv, denv);
  }
}

function directstyleInvoke(apply, fn, args, denv) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return values;
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return values;
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return directstyleEvalSerialForms(fn.serialForms, elenv, denv);
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return directstyleEvalSerialForms(fn.serialForms, fn.lenv, edenv);
      default:
        throw new CannotHappen('directstyleInvoke');
    }
  } else {
    throw new CannotHappen('directstyleInvoke');
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
    return k(new EmptyListError());
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return cpsEvalQuote(form, lenv, denv, k);
      case prognVariable:
        return cpsEvalProgn(form, lenv, denv, k);
      case ifVariable:
        return cpsEvalIf(form, lenv, denv, k);
      case _forEachVariable:
        return cpsEvalForEach(form, lenv, denv, k);
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
      case blockVariable:
        return cpsEvalBlock(form, lenv, denv, k);
      case returnFromVariable:
        return cpsEvalReturnFrom(form, lenv, denv, k);
      case catchVariable:
        return cpsEvalCatch(form, lenv, denv, k);
      case throwVariable:
        return cpsEvalThrow(form, lenv, denv, k);
      case _handlerBindVariable:
        return cpsEvalHandlerBind(form, lenv, denv, k);
      case unwindProtectVariable:
        return cpsEvalUnwindProtect(form, lenv, denv, k);
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

const cpsEndCont = outcome => outcome;

function cpsEvalQuote(form, lenv, denv, k) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return k(analysis);
  const [literal] = analysis;
  return k(literal);
}

function cpsEvalProgn(form, lenv, denv, k) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return k(analysis);
  const [serialForms] = analysis;
  return cpsEvalSerialForms(serialForms, lenv, denv, k);
}

function cpsEvalSerialForms(serialForms, lenv, denv, k) {
  if (serialForms === EVLEmptyList.NIL) {
    return k(EVLVoid.VOID);
  } else {
    return cpsEvalSerialFormForms(serialForms, lenv, denv, k);
  }
}

function cpsEvalSerialFormForms(serialForms, lenv, denv, k) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return cpsEvalForm(serialForms.car, lenv, denv, k);
  } else {
    return cpsEvalForm(
      serialForms.car, lenv, denv,
      outcome => { // SerialFormCont
        if (isAbruptCompletion(outcome)) return k(outcome);
        return cpsEvalSerialFormForms(serialForms.cdr, lenv, denv, k);
      }
    );
  }
}

function cpsEvalIf(form, lenv, denv, k) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return k(analysis);
  const [testForm, thenForm, elseForm] = analysis;
  return cpsEvalForm(
    testForm, lenv, denv,
    outcome => { // IfTestFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const test = outcome.primaryValue();
      switch (test) {
        case EVLBoolean.TRUE:
          return cpsEvalForm(thenForm, lenv, denv, k);
        case EVLBoolean.FALSE:
          return cpsEvalForm(elseForm, lenv, denv, k);
        default:
          return k(new TestFormTypeError());
      }
    }
  );
}

function cpsEvalForEach(form, lenv, denv, k) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return k(analysis);
  const [functionForm, listForm] = analysis;
  return cpsEvalForm(
    functionForm, lenv, denv,
    outcome => { // ForEachFunctionFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const fn = outcome.primaryValue();
      if (!(fn instanceof EVLFunction)) {
        return k(new FunctionFormTypeError());
      }
      return cpsEvalForm(
        listForm, lenv, denv,
        outcome => { // ForEachListFormCont
          if (isAbruptCompletion(outcome)) return k(outcome);
          const list = outcome.primaryValue();
          if (!isProperList(list)) {
            return k(new ListFormTypeError());
          }
          return cpsForEach(fn, list, denv, k);
        }
      );
    }
  );
}

function cpsForEach(fn, list, denv, k) {
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      const outcome = cpsInvoke(false, fn, [list.car], denv, cpsEndCont);
      if (isAbruptCompletion(outcome)) return k(outcome);
      list = list.cdr;
    } else {
      throw new CannotHappen('cpsForEach'); // list is a proper list
    }
  }
  return k(EVLVoid.VOID);
}

function cpsEvalLambda(scope, namespace, macro, form, lenv, denv, k) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return k(analysis);
  const [parameters, rest, serialForms] = analysis;
  return k(new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv));
}

function cpsEvalRef(scope, namespace, form, lenv, denv, k) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return k(analysis);
  const [variable] = analysis;
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
  const analysis = analyzeSet(form);
  if (isError(analysis)) return k(analysis);
  const [variable, valueForm] = analysis;
  return cpsEvalForm(
    valueForm, lenv, denv,
    outcome => { // SetValueFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const value = outcome.primaryValue()
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

function cpsEvalBlock(form, lenv, denv, k) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return k(analysis);
  const [blockName, serialForms] = analysis;
  const exitTag = new EVLVariable('exit-tag');
  const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
  const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
  return cpsEvalSerialForms(
    serialForms, elenv, edenv,
    outcome => { // BlockSerialFormsCont
      if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
        return k(outcome.values);
      } else {
        return k(outcome);
      }
    }
  );
}

function cpsEvalReturnFrom(form, lenv, denv, k) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return k(analysis);
  const [blockName, valuesForm] = analysis;
  const exitTag = lenv.ref(BLK_NS, blockName);
  if (exitTag === null) {
    return k(new NoBlock(blockName));
  }
  const exitPoint = denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return k(new NoBlockExitPoint(blockName));
  }
  return cpsEvalForm(
    valuesForm, lenv, denv,
    outcome => { // ReturnFromValuesFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      return k(new NonlocalExit(exitTag, outcome));
    }
  );
}

function cpsEvalCatch(form, lenv, denv, k) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return k(analysis);
  const [exitTagForm, serialForms] = analysis;
  return cpsEvalForm(
    exitTagForm, lenv, denv,
    outcome => { // CatchExitTagFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const exitTag = outcome.primaryValue();
      if (!(exitTag instanceof EVLVariable)) {
        return k(new ExitTagFormTypeError());
      }
      const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
      return cpsEvalSerialForms(
        serialForms, lenv, edenv,
        outcome2 => { // CatchSerialFormsCont
          if (isNonlocalExit(outcome2) && outcome2.exitTag === exitTag) {
            return k(outcome2.values);
          } else {
            return k(outcome2);
          }
        }
      );
    }
  );
}

function cpsEvalThrow(form, lenv, denv, k) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return k(analysis);
  const [exitTagForm, valuesForm] = analysis;
  return cpsEvalForm(
    exitTagForm, lenv, denv,
    outcome => { // ThrowExitTagFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const exitTag = outcome.primaryValue();
      if (!(exitTag instanceof EVLVariable)) {
        return k(new ExitTagFormTypeError());
      }
      const exitPoint = denv.ref(XIT_NS, exitTag);
      if (exitPoint === null) {
        return k(new NoCatchExitPoint(exitTag));
      }
      return cpsEvalForm(
        valuesForm, lenv, denv,
        outcome2 => { // ThrowValuesFormCont
          if (isAbruptCompletion(outcome2)) return k(outcome2);
          return k(new NonlocalExit(exitTag, outcome2));
        }
      );
    }
  );
}

function cpsEvalHandlerBind(form, lenv, denv, k) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return k(analysis);
  const [handlerForm, serialForms] = analysis;
  return cpsEvalForm(
    handlerForm, lenv, denv,
    outcome => { // HandlerBindHandlerFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const handler = outcome.primaryValue();
      if (!(handler instanceof EVLFunction)) {
        return k(new HandlerFormTypeError());
      }
      return cpsEvalSerialForms(
        serialForms, lenv, denv,
        outcome2 => { // HandlerBindSerialFormsCont
          if (isError(outcome2)) {
            return cpsInvoke(
              false, handler, [outcome2.category, outcome2.description], denv,
              outcome3 => { // HandlerBindInvocationCont
                if (isAbruptCompletion(outcome3)) {
                  return k(outcome3);
                } else {
                  return k(outcome2);
                }
              }
            );
          } else {
            return k(outcome2);
          }
        }
      );
    }
  );
}

function cpsEvalUnwindProtect(form, lenv, denv, k) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return k(analysis);
  const [protectedForm, cleanupForms] = analysis;
  return cpsEvalForm(
    protectedForm, lenv, denv,
    outcome => { // UnwindProtectProtectedFormCont
      return cpsEvalSerialForms(
        cleanupForms, lenv, denv,
        outcome2 => { // UnwindProtectCleanupFormsCont
          if (isAbruptCompletion(outcome2)) {
            return k(outcome2);
          } else {
            return k(outcome);
          }
        }
      );
    }
  );
}

function cpsEvalCall(mv, apply, form, lenv, denv, k) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return k(analysis);
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return cpsEvalMacroCall(form, operator, operands, lenv, denv, k);
  } else {
    return cpsEvalFunctionCall(mv, apply, operator, operands, lenv, denv, k);
  }
}

function cpsEvalMacroCall(form, macro, macroOperands, lenv, denv, k) {
  const args = listToArray(macroOperands);
  const outcome = cpsInvoke(false, macro, args, denv, cpsEndCont);
  if (isAbruptCompletion(outcome)) return k(outcome);
  const expansion = outcome.primaryValue();
  if (optimizeMacroCalls) {
    alterForm(form, expansion);
  }
  return cpsEvalForm(expansion, lenv, denv, k);
}

function cpsEvalFunctionCall(mv, apply, operatorForm, operandForms, lenv, denv, k) {
  return cpsEvalOperatorForm(
    operatorForm, lenv, denv,
    outcome => { // FunctionCallOperatorFormCont
      if (isAbruptCompletion(outcome)) return k(outcome);
      const fn = outcome.primaryValue();
      if (!(fn instanceof EVLFunction)) {
        return k(new OperatorFormTypeError());
      }
      return cpsEvalOperandForms(mv, apply, fn, operandForms, [], lenv, denv, k);
    }
  );
}

function cpsEvalOperatorForm(operatorForm, lenv, denv, k) {
  if (operatorForm instanceof EVLVariable) {
    return k(lenv.ref(FUN_NS, operatorForm));
  } else {
    return cpsEvalForm(operatorForm, lenv, denv, k);
  }
}

function cpsEvalOperandForms(mv, apply, fn, operandForms, args, lenv, denv, k) {
  if (operandForms === EVLEmptyList.NIL) {
    return cpsInvoke(apply, fn, args, denv, k);
  } else {
    return cpsEvalForm(
      operandForms.car, lenv, denv,
      outcome => { // FunctionCallOperandFormCont
        if (isAbruptCompletion(outcome)) return k(outcome);
        if (mv) {
          outcome.allValues().forEach(value => args.push(value));
        } else {
          args.push(outcome.primaryValue());
        }
        return cpsEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv, denv, k);
      }
    );
  }
}

function cpsInvoke(apply, fn, args, denv, k) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return k(values);
    return k(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return k(values);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return cpsEvalSerialForms(fn.serialForms, elenv, denv, k);
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return cpsEvalSerialForms(fn.serialForms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('cpsInvoke');
    }
  } else {
    throw new CannotHappen('cpsInvoke');
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
    return k.invoke(new EmptyListError());
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return oocpsEvalQuote(form, lenv, denv, k);
      case prognVariable:
        return oocpsEvalProgn(form, lenv, denv, k);
      case ifVariable:
        return oocpsEvalIf(form, lenv, denv, k);
      case _forEachVariable:
        return oocpsEvalForEach(form, lenv, denv, k);
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
      case blockVariable:
        return oocpsEvalBlock(form, lenv, denv, k);
      case returnFromVariable:
        return oocpsEvalReturnFrom(form, lenv, denv, k);
      case catchVariable:
        return oocpsEvalCatch(form, lenv, denv, k);
      case throwVariable:
        return oocpsEvalThrow(form, lenv, denv, k);
      case _handlerBindVariable:
        return oocpsEvalHandlerBind(form, lenv, denv, k);
      case unwindProtectVariable:
        return oocpsEvalUnwindProtect(form, lenv, denv, k);
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
  constructor(k) {
    this.k = k;
  }
}

class OOCPSEndCont extends OOCPSCont {
  constructor() {
    super(null);
  }
  invoke(outcome) {
    return outcome;
  }
}

const oocpsEndCont = new OOCPSEndCont();

function oocpsEvalQuote(form, lenv, denv, k) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [literal] = analysis;
  return k.invoke(literal);
}

function oocpsEvalProgn(form, lenv, denv, k) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [serialForms] = analysis;
  return oocpsEvalSerialForms(serialForms, lenv, denv, k);
}

function oocpsEvalSerialForms(serialForms, lenv, denv, k) {
  if (serialForms === EVLEmptyList.NIL) {
    return k.invoke(EVLVoid.VOID);
  } else {
    return oocpsEvalSerialFormForms(serialForms, lenv, denv, k);
  }
}

function oocpsEvalSerialFormForms(serialForms, lenv, denv, k) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return oocpsEvalForm(serialForms.car, lenv, denv, k);
  } else {
    return oocpsEvalForm(
      serialForms.car, lenv, denv,
      new OOCPSSerialFormCont(serialForms, lenv, denv, k)
    );
  }
}

class OOCPSSerialFormCont extends OOCPSCont {
  constructor(serialForms, lenv, denv, k) {
    super(k);
    this.serialForms = serialForms;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {serialForms, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    return oocpsEvalSerialFormForms(serialForms.cdr, lenv, denv, k);
  }
}

function oocpsEvalIf(form, lenv, denv, k) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [testForm, thenForm, elseForm] = analysis;
  return oocpsEvalForm(
    testForm, lenv, denv,
    new OOCPSIfTestFormCont(thenForm, elseForm, lenv, denv, k)
  );
}

class OOCPSIfTestFormCont extends OOCPSCont {
  constructor(thenForm, elseForm, lenv, denv, k) {
    super(k);
    this.thenForm = thenForm;
    this.elseForm = elseForm;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {thenForm, elseForm, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const test = outcome.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return oocpsEvalForm(thenForm, lenv, denv, k);
      case EVLBoolean.FALSE:
        return oocpsEvalForm(elseForm, lenv, denv, k);
      default:
        return k.invoke(new TestFormTypeError());
    }
  }
}

function oocpsEvalForEach(form, lenv, denv, k) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [functionForm, listForm] = analysis;
  return oocpsEvalForm(
    functionForm, lenv, denv,
    new OOCPSForEachFunctionFormCont(listForm, lenv, denv, k)
  );
}

class OOCPSForEachFunctionFormCont extends OOCPSCont {
  constructor(listForm, lenv, denv, k) {
    super(k);
    this.listForm = listForm;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {listForm, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return k.invoke(new FunctionFormTypeError());
    }
    return oocpsEvalForm(
      listForm, lenv, denv,
      new OOCPSForEachListFormCont(fn, denv, k)
    );
  }
}

class OOCPSForEachListFormCont extends OOCPSCont {
  constructor(fn, denv, k) {
    super(k);
    this.fn = fn;
    this.denv = denv;
  }
  invoke(outcome) {
    const {fn, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const list = outcome.primaryValue();
    if (!isProperList(list)) {
      return k.invoke(new ListFormTypeError());
    }
    return oocpsForEach(fn, list, denv, k);
  }
}

function oocpsForEach(fn, list, denv, k) {
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      const outcome = oocpsInvoke(false, fn, [list.car], denv, oocpsEndCont);
      if (isAbruptCompletion(outcome)) return k.invoke(outcome);
      list = list.cdr;
    } else {
      throw new CannotHappen('oocpsForEach'); // list is a proper list
    }
  }
  return k.invoke(EVLVoid.VOID);
}

function oocpsEvalLambda(scope, namespace, macro, form, lenv, denv, k) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [parameters, rest, serialForms] = analysis;
  return k.invoke(new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv));
}

function oocpsEvalRef(scope, namespace, form, lenv, denv, k) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [variable] = analysis;
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
  const analysis = analyzeSet(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [variable, valueForm] = analysis;
  return oocpsEvalForm(
    valueForm, lenv, denv,
    new OOCPSSetValueFormCont(scope, namespace, variable, lenv, denv, k)
  );
}

class OOCPSSetValueFormCont extends OOCPSCont {
  constructor(scope, namespace, variable, lenv, denv, k) {
    super(k);
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {scope, namespace, variable, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const value = outcome.primaryValue()
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

function oocpsEvalBlock(form, lenv, denv, k) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [blockName, serialForms] = analysis;
  const exitTag = new EVLVariable('exit-tag');
  const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
  const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
  return oocpsEvalSerialForms(
    serialForms, elenv, edenv,
    new OOCPSBlockSerialFormsCont(exitTag, k)
  );
}

class OOCPSBlockSerialFormsCont extends OOCPSCont {
  constructor(exitTag, k) {
    super(k);
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag, k} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return k.invoke(outcome.values);
    } else {
      return k.invoke(outcome);
    }
  }
}

function oocpsEvalReturnFrom(form, lenv, denv, k) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [blockName, valuesForm] = analysis;
  const exitTag = lenv.ref(BLK_NS, blockName);
  if (exitTag === null) {
    return k.invoke(new NoBlock(blockName));
  }
  const exitPoint = denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return k.invoke(new NoBlockExitPoint(blockName));
  }
  return oocpsEvalForm(
    valuesForm, lenv, denv,
    new OOCPSReturnFromValuesFormCont(exitTag, k)
  );
}

class OOCPSReturnFromValuesFormCont extends OOCPSCont {
  constructor(exitTag, k) {
    super(k);
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    return k.invoke(new NonlocalExit(exitTag, outcome));
  }
}

function oocpsEvalCatch(form, lenv, denv, k) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [exitTagForm, serialForms] = analysis;
  return oocpsEvalForm(
    exitTagForm, lenv, denv,
    new OOCPSCatchExitTagFormCont(serialForms, lenv, denv, k)
  );
}

class OOCPSCatchExitTagFormCont extends OOCPSCont {
  constructor(serialForms, lenv, denv, k) {
    super(k);
    this.serialForms = serialForms;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {serialForms, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return k.invoke(new ExitTagFormTypeError());
    }
    const edenv = new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], denv);
    return oocpsEvalSerialForms(
      serialForms, lenv, edenv,
      new OOCPSCatchSerialFormsCont(exitTag, k)
    );
  }
}

class OOCPSCatchSerialFormsCont extends OOCPSCont {
  constructor(exitTag, k) {
    super(k);
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag, k} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return k.invoke(outcome.values);
    } else {
      return k.invoke(outcome);
    }
  }
}

function oocpsEvalThrow(form, lenv, denv, k) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [exitTagForm, valuesForm] = analysis;
  return oocpsEvalForm(
    exitTagForm, lenv, denv,
    new OOCPSThrowExitTagFormCont(valuesForm, lenv, denv, k)
  );
}

class OOCPSThrowExitTagFormCont extends OOCPSCont {
  constructor(valuesForm, lenv, denv, k) {
    super(k);
    this.valuesForm = valuesForm;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {valuesForm, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return k.invoke(new ExitTagFormTypeError());
    }
    const exitPoint = denv.ref(XIT_NS, exitTag);
    if (exitPoint === null) {
      return k.invoke(new NoCatchExitPoint(exitTag));
    }
    return oocpsEvalForm(
      valuesForm, lenv, denv,
      new OOCPSThrowValuesFormCont(exitTag, k)
    );
  }
}

class OOCPSThrowValuesFormCont extends OOCPSCont {
  constructor(exitTag, k) {
    super(k);
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    return k.invoke(new NonlocalExit(exitTag, outcome));
  }
}

function oocpsEvalHandlerBind(form, lenv, denv, k) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [handlerForm, serialForms] = analysis;
  return oocpsEvalForm(
    handlerForm, lenv, denv,
    new OOCPSHandlerBindHandlerFormCont(serialForms, lenv, denv, k)
  );
}

class OOCPSHandlerBindHandlerFormCont extends OOCPSCont {
  constructor(serialForms, lenv, denv, k) {
    super(k);
    this.serialForms = serialForms;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {serialForms, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const handler = outcome.primaryValue();
    if (!(handler instanceof EVLFunction)) {
      return k.invoke(new HandlerFormTypeError());
    }
    return oocpsEvalSerialForms(
      serialForms, lenv, denv,
      new OOCPSHandlerBindSerialFormsCont(handler, denv, k)
    );
  }
}

class OOCPSHandlerBindSerialFormsCont extends OOCPSCont {
  constructor(handler, denv, k) {
    super(k);
    this.handler = handler;
    this.denv = denv;
  }
  invoke(outcome) {
    const {handler, denv, k} = this;
    if (isError(outcome)) {
      return oocpsInvoke(
        false, handler, [outcome.category, outcome.description], denv,
        new OOCPSHandlerBindInvocationCont(outcome, k)
      );
    } else {
      return k.invoke(outcome);
    }
  }
}

class OOCPSHandlerBindInvocationCont extends OOCPSCont {
  constructor(serialFormsOutcome, k) {
    super(k);
    this.serialFormsOutcome = serialFormsOutcome;
  }
  invoke(outcome) {
    const {serialFormsOutcome, k} = this;
    if (isAbruptCompletion(outcome)) {
      return k.invoke(outcome);
    } else {
      return k.invoke(serialFormsOutcome);
    }
  }
}

function oocpsEvalUnwindProtect(form, lenv, denv, k) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return k.invoke(analysis);
  const [protectedForm, cleanupForms] = analysis;
  return oocpsEvalForm(
    protectedForm, lenv, denv,
    new OOCPSUnwindProtectProtectedFormCont(cleanupForms, lenv, denv, k)
  );
}

class OOCPSUnwindProtectProtectedFormCont extends OOCPSCont {
  constructor(cleanupForms, lenv, denv, k) {
    super(k);
    this.cleanupForms = cleanupForms;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {cleanupForms, lenv, denv, k} = this;
    return oocpsEvalSerialForms(
      cleanupForms, lenv, denv,
      new OOCPSUnwindProtectCleanupFormsCont(outcome, k)
    );
  }
}

class OOCPSUnwindProtectCleanupFormsCont extends OOCPSCont {
  constructor(protectedFormOutcome, k) {
    super(k);
    this.protectedFormOutcome = protectedFormOutcome;
  }
  invoke(outcome) {
    const {protectedFormOutcome, k} = this;
    if (isAbruptCompletion(outcome)) {
      return k.invoke(outcome);
    } else {
      return k.invoke(protectedFormOutcome);
    }
  }
}

function oocpsEvalCall(mv, apply, form, lenv, denv, k) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return k.invoke(analysis);
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return oocpsEvalMacroCall(form, operator, operands, lenv, denv, k);
  } else {
    return oocpsEvalFunctionCall(mv, apply, operator, operands, lenv, denv, k);
  }
}

function oocpsEvalMacroCall(form, macro, macroOperands, lenv, denv, k) {
  const args = listToArray(macroOperands);
  const outcome = oocpsInvoke(false, macro, args, denv, oocpsEndCont);
  if (isAbruptCompletion(outcome)) return k.invoke(outcome);
  const expansion = outcome.primaryValue();
  if (optimizeMacroCalls) {
    alterForm(form, expansion);
  }
  return oocpsEvalForm(expansion, lenv, denv, k);
}

function oocpsEvalFunctionCall(mv, apply, operatorForm, operandForms, lenv, denv, k) {
  return oocpsEvalOperatorForm(
    operatorForm, lenv, denv,
    new OOCPSFunctionCallOperatorFormCont(mv, apply, operandForms, lenv, denv, k)
  );
}

function oocpsEvalOperatorForm(operatorForm, lenv, denv, k) {
  if (operatorForm instanceof EVLVariable) {
    return k.invoke(lenv.ref(FUN_NS, operatorForm));
  } else {
    return oocpsEvalForm(operatorForm, lenv, denv, k);
  }
}

class OOCPSFunctionCallOperatorFormCont extends OOCPSCont {
  constructor(mv, apply, operandForms, lenv, denv, k) {
    super(k);
    this.mv = mv;
    this.apply = apply;
    this.operandForms = operandForms;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {mv, apply, operandForms, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return k.invoke(new OperatorFormTypeError());
    }
    return oocpsEvalOperandForms(mv, apply, fn, operandForms, [], lenv, denv, k);
  }
}

function oocpsEvalOperandForms(mv, apply, fn, operandForms, args, lenv, denv, k) {
  if (operandForms === EVLEmptyList.NIL) {
    return oocpsInvoke(apply, fn, args, denv, k);
  } else {
    return oocpsEvalForm(
      operandForms.car, lenv, denv,
      new OOCPSFunctionCallOperandFormCont(mv, apply, fn, operandForms, args, lenv, denv, k)
    );
  }
}

class OOCPSFunctionCallOperandFormCont extends OOCPSCont {
  constructor(mv, apply, fn, operandForms, args, lenv, denv, k) {
    super(k);
    this.mv = mv;
    this.apply = apply;
    this.fn = fn;
    this.operandForms = operandForms;
    this.args = args;
    this.lenv = lenv;
    this.denv = denv;
  }
  invoke(outcome) {
    const {mv, apply, fn, operandForms, args, lenv, denv, k} = this;
    if (isAbruptCompletion(outcome)) return k.invoke(outcome);
    if (mv) {
      outcome.allValues().forEach(value => args.push(value));
    } else {
      args.push(outcome.primaryValue());
    }
    return oocpsEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv, denv, k);
  }
}

function oocpsInvoke(apply, fn, args, denv, k) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return k.invoke(values);
    return k.invoke(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return k.invoke(values);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return oocpsEvalSerialForms(fn.serialForms, elenv, denv, k);
      case DYN_SCOPE:
        const edenv = new Frame(fn.namespace, fn.parameters, values, denv);
        return oocpsEvalSerialForms(fn.serialForms, fn.lenv, edenv, k);
      default:
        throw new CannotHappen('oocpsInvoke');
    }
  } else {
    throw new CannotHappen('oocpsInvoke');
  }
}

/*********************************************/
/* Stack-Based Object-Oriented CPS Evaluator */
/*********************************************/

let sboocpsStack = null;

class SBOOCPSStack {
  constructor() {
    this.stack = [sboocpsEndCont]; // array of SBOOCPSCont's and/or Frame's
    this.denv = nullDefiniteEnv;
  }
  push(element) {
    if (element instanceof SBOOCPSCont) {
      this.stack.push(element);
    } else if (element instanceof Frame) {
      this.stack.push(element);
      element.next = this.denv;
      this.denv = element;
    } else {
      throw new CannotHappen('SBOOCPSStack.push');
    }
  }
  invoke(outcome) {
    while (true) {
      const element = this.stack.pop();
      if (element instanceof SBOOCPSCont) {
        return element.invoke(outcome);
      } else if (element instanceof Frame) {
        this.denv = element.next;
      } else {
        throw new CannotHappen('SBOOCPSStack.invoke');
      }
    }
  }
}

function sboocpsEval(form) {
  sboocpsStack = new SBOOCPSStack();
  return sboocpsEvalForm(form, nullDefiniteEnv);
}

function sboocpsEvalForm(form, lenv) {
  if (form instanceof EVLEmptyList) {
    return sboocpsStack.invoke(new EmptyListError());
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return sboocpsEvalQuote(form, lenv);
      case prognVariable:
        return sboocpsEvalProgn(form, lenv);
      case ifVariable:
        return sboocpsEvalIf(form, lenv);
      case _forEachVariable:
        return sboocpsEvalForEach(form, lenv);
      case _vlambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv);
      case _mlambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv);
      case _flambdaVariable:
        return sboocpsEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv);
      case _dlambdaVariable:
        return sboocpsEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv);
      case vrefVariable:
        return sboocpsEvalRef(LEX_SCOPE, VAL_NS, form, lenv);
      case vsetVariable:
        return sboocpsEvalSet(LEX_SCOPE, VAL_NS, form, lenv);
      case frefVariable:
        return sboocpsEvalRef(LEX_SCOPE, FUN_NS, form, lenv);
      case fsetVariable:
        return sboocpsEvalSet(LEX_SCOPE, FUN_NS, form, lenv);
      case drefVariable:
        return sboocpsEvalRef(DYN_SCOPE, VAL_NS, form, lenv);
      case dsetVariable:
        return sboocpsEvalSet(DYN_SCOPE, VAL_NS, form, lenv);
      case blockVariable:
        return sboocpsEvalBlock(form, lenv);
      case returnFromVariable:
        return sboocpsEvalReturnFrom(form, lenv);
      case catchVariable:
        return sboocpsEvalCatch(form, lenv);
      case throwVariable:
        return sboocpsEvalThrow(form, lenv);
      case _handlerBindVariable:
        return sboocpsEvalHandlerBind(form, lenv);
      case unwindProtectVariable:
        return sboocpsEvalUnwindProtect(form, lenv);
      case applyVariable:
        return sboocpsEvalCall(false, true, form, lenv);
      case multipleValueCallVariable:
        return sboocpsEvalCall(true, false, form, lenv);
      case multipleValueApplyVariable:
        return sboocpsEvalCall(true, true, form, lenv);
      default:
        return sboocpsEvalCall(false, false, form, lenv);
    }
  } else if (form instanceof EVLVariable) {
    return sboocpsStack.invoke(lenv.ref(VAL_NS, form));
  } else {
    return sboocpsStack.invoke(form);
  }
}

class SBOOCPSCont { // abstract class
  constructor() {
  }
}

class SBOOCPSEndCont extends SBOOCPSCont {
  constructor() {
    super();
  }
  invoke(outcome) {
    return outcome;
  }
}

const sboocpsEndCont = new SBOOCPSEndCont();

function sboocpsEvalQuote(form, lenv) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [literal] = analysis;
  return sboocpsStack.invoke(literal);
}

function sboocpsEvalProgn(form, lenv) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [serialForms] = analysis;
  return sboocpsEvalSerialForms(serialForms, lenv);
}

function sboocpsEvalSerialForms(serialForms, lenv) {
  if (serialForms === EVLEmptyList.NIL) {
    return sboocpsStack.invoke(EVLVoid.VOID);
  } else {
    return sboocpsEvalSerialFormForms(serialForms, lenv);
  }
}

function sboocpsEvalSerialFormForms(serialForms, lenv) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return sboocpsEvalForm(serialForms.car, lenv);
  } else {
    sboocpsStack.push(new SBOOCPSSerialFormCont(serialForms, lenv));
    return sboocpsEvalForm(serialForms.car, lenv);
  }
}

class SBOOCPSSerialFormCont extends SBOOCPSCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    return sboocpsEvalSerialFormForms(serialForms.cdr, lenv);
  }
}

function sboocpsEvalIf(form, lenv) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [testForm, thenForm, elseForm] = analysis;
  sboocpsStack.push(new SBOOCPSIfTestFormCont(thenForm, elseForm, lenv));
  return sboocpsEvalForm(testForm, lenv);
}

class SBOOCPSIfTestFormCont extends SBOOCPSCont {
  constructor(thenForm, elseForm, lenv) {
    super();
    this.thenForm = thenForm;
    this.elseForm = elseForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {thenForm, elseForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const test = outcome.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return sboocpsEvalForm(thenForm, lenv);
      case EVLBoolean.FALSE:
        return sboocpsEvalForm(elseForm, lenv);
      default:
        return sboocpsStack.invoke(new TestFormTypeError());
    }
  }
}

function sboocpsEvalForEach(form, lenv) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [functionForm, listForm] = analysis;
  sboocpsStack.push(new SBOOCPSForEachFunctionFormCont(listForm, lenv));
  return sboocpsEvalForm(functionForm, lenv);
}

class SBOOCPSForEachFunctionFormCont extends SBOOCPSCont {
  constructor(listForm, lenv) {
    super();
    this.listForm = listForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {listForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return sboocpsStack.invoke(new FunctionFormTypeError());
    }
    sboocpsStack.push(new SBOOCPSForEachListFormCont(fn));
    return sboocpsEvalForm(listForm, lenv);
  }
}

class SBOOCPSForEachListFormCont extends SBOOCPSCont {
  constructor(fn) {
    super();
    this.fn = fn;
  }
  invoke(outcome) {
    const {fn} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const list = outcome.primaryValue();
    if (!isProperList(list)) {
      return sboocpsStack.invoke(new ListFormTypeError());
    }
    return sboocpsForEach(fn, list);
  }
}

function sboocpsForEach(fn, list) {
  while (list !== EVLEmptyList.NIL) {
    if (list instanceof EVLCons) {
      sboocpsStack.push(sboocpsEndCont);
      const outcome = sboocpsInvoke(false, fn, [list.car]);
      if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
      list = list.cdr;
    } else {
      throw new CannotHappen('sboocpsForEach'); // list is a proper list
    }
  }
  return sboocpsStack.invoke(EVLVoid.VOID);
}

function sboocpsEvalLambda(scope, namespace, macro, form, lenv) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [parameters, rest, serialForms] = analysis;
  return sboocpsStack.invoke(new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv));
}

function sboocpsEvalRef(scope, namespace, form, lenv) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [variable] = analysis;
  switch (scope) {
    case LEX_SCOPE:
      return sboocpsStack.invoke(lenv.ref(namespace, variable));
    case DYN_SCOPE:
      return sboocpsStack.invoke(sboocpsStack.denv.ref(namespace, variable));
    default:
      throw new CannotHappen('sboocpsEvalRef');
  }
}

function sboocpsEvalSet(scope, namespace, form, lenv) {
  const analysis = analyzeSet(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [variable, valueForm] = analysis;
  sboocpsStack.push(new SBOOCPSSetValueFormCont(scope, namespace, variable, lenv));
  return sboocpsEvalForm(valueForm, lenv);
}

class SBOOCPSSetValueFormCont extends SBOOCPSCont {
  constructor(scope, namespace, variable, lenv) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {scope, namespace, variable, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const value = outcome.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return sboocpsStack.invoke(lenv.set(namespace, variable, value));
      case DYN_SCOPE:
        return sboocpsStack.invoke(sboocpsStack.denv.set(namespace, variable, value));
      default:
        throw new CannotHappen('SBOOCPSSetValueFormCont.invoke');
    }
  }
}

function sboocpsEvalBlock(form, lenv) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [blockName, serialForms] = analysis;
  const exitTag = new EVLVariable('exit-tag');
  const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
  sboocpsStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
  sboocpsStack.push(new SBOOCPSBlockSerialFormsCont(exitTag));
  return sboocpsEvalSerialForms(serialForms, elenv);
}

class SBOOCPSBlockSerialFormsCont extends SBOOCPSCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return sboocpsStack.invoke(outcome.values);
    } else {
      return sboocpsStack.invoke(outcome);
    }
  }
}

function sboocpsEvalReturnFrom(form, lenv) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [blockName, valuesForm] = analysis;
  const exitTag = lenv.ref(BLK_NS, blockName);
  if (exitTag === null) {
    return sboocpsStack.invoke(new NoBlock(blockName));
  }
  const exitPoint = sboocpsStack.denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return sboocpsStack.invoke(new NoBlockExitPoint(blockName));
  }
  sboocpsStack.push(new SBOOCPSReturnFromValuesFormCont(exitTag));
  return sboocpsEvalForm(valuesForm, lenv);
}

class SBOOCPSReturnFromValuesFormCont extends SBOOCPSCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    return sboocpsStack.invoke(new NonlocalExit(exitTag, outcome));
  }
}

function sboocpsEvalCatch(form, lenv) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [exitTagForm, serialForms] = analysis;
  sboocpsStack.push(new SBOOCPSCatchExitTagFormCont(serialForms, lenv));
  return sboocpsEvalForm(exitTagForm, lenv);
}

class SBOOCPSCatchExitTagFormCont extends SBOOCPSCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return sboocpsStack.invoke(new ExitTagFormTypeError());
    }
    sboocpsStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
    sboocpsStack.push(new SBOOCPSCatchSerialFormsCont(exitTag));
    return sboocpsEvalSerialForms(serialForms, lenv);
  }
}

class SBOOCPSCatchSerialFormsCont extends SBOOCPSCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return sboocpsStack.invoke(outcome.values);
    } else {
      return sboocpsStack.invoke(outcome);
    }
  }
}

function sboocpsEvalThrow(form, lenv) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [exitTagForm, valuesForm] = analysis;
  sboocpsStack.push(new SBOOCPSThrowExitTagFormCont(valuesForm, lenv));
  return sboocpsEvalForm(exitTagForm, lenv);
}

class SBOOCPSThrowExitTagFormCont extends SBOOCPSCont {
  constructor(valuesForm, lenv) {
    super();
    this.valuesForm = valuesForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {valuesForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return sboocpsStack.invoke(new ExitTagFormTypeError());
    }
    const exitPoint = sboocpsStack.denv.ref(XIT_NS, exitTag);
    if (exitPoint === null) {
      return sboocpsStack.invoke(new NoCatchExitPoint(exitTag));
    }
    sboocpsStack.push(new SBOOCPSThrowValuesFormCont(exitTag));
    return sboocpsEvalForm(valuesForm, lenv);
  }
}

class SBOOCPSThrowValuesFormCont extends SBOOCPSCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    return sboocpsStack.invoke(new NonlocalExit(exitTag, outcome));
  }
}

function sboocpsEvalHandlerBind(form, lenv) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [handlerForm, serialForms] = analysis;
  sboocpsStack.push(new SBOOCPSHandlerBindHandlerFormCont(serialForms, lenv));
  return sboocpsEvalForm(handlerForm, lenv);
}

class SBOOCPSHandlerBindHandlerFormCont extends SBOOCPSCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const handler = outcome.primaryValue();
    if (!(handler instanceof EVLFunction)) {
      return sboocpsStack.invoke(new HandlerFormTypeError());
    }
    sboocpsStack.push(new SBOOCPSHandlerBindSerialFormsCont(handler));
    return sboocpsEvalSerialForms(serialForms, lenv);
  }
}

class SBOOCPSHandlerBindSerialFormsCont extends SBOOCPSCont {
  constructor(handler) {
    super();
    this.handler = handler;
  }
  invoke(outcome) {
    const {handler} = this;
    if (isError(outcome)) {
      sboocpsStack.push(new SBOOCPSHandlerBindInvocationCont(outcome));
      return sboocpsInvoke(false, handler, [outcome.category, outcome.description]);
    } else {
      return sboocpsStack.invoke(outcome);
    }
  }
}

class SBOOCPSHandlerBindInvocationCont extends SBOOCPSCont {
  constructor(serialFormsOutcome) {
    super();
    this.serialFormsOutcome = serialFormsOutcome;
  }
  invoke(outcome) {
    const {serialFormsOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return sboocpsStack.invoke(outcome);
    } else {
      return sboocpsStack.invoke(serialFormsOutcome);
    }
  }
}

function sboocpsEvalUnwindProtect(form, lenv) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [protectedForm, cleanupForms] = analysis;
  sboocpsStack.push(new SBOOCPSUnwindProtectProtectedFormCont(cleanupForms, lenv));
  return sboocpsEvalForm(protectedForm, lenv);
}

class SBOOCPSUnwindProtectProtectedFormCont extends SBOOCPSCont {
  constructor(cleanupForms, lenv) {
    super();
    this.cleanupForms = cleanupForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {cleanupForms, lenv} = this;
    sboocpsStack.push(new SBOOCPSUnwindProtectCleanupFormsCont(outcome));
    return sboocpsEvalSerialForms(cleanupForms, lenv);
  }
}

class SBOOCPSUnwindProtectCleanupFormsCont extends SBOOCPSCont {
  constructor(protectedFormOutcome) {
    super();
    this.protectedFormOutcome = protectedFormOutcome;
  }
  invoke(outcome) {
    const {protectedFormOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return sboocpsStack.invoke(outcome);
    } else {
      return sboocpsStack.invoke(protectedFormOutcome);
    }
  }
}

function sboocpsEvalCall(mv, apply, form, lenv) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return sboocpsStack.invoke(analysis);
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return sboocpsEvalMacroCall(form, operator, operands, lenv);
  } else {
    return sboocpsEvalFunctionCall(mv, apply, operator, operands, lenv);
  }
}

function sboocpsEvalMacroCall(form, macro, macroOperands, lenv) {
  const args = listToArray(macroOperands);
  sboocpsStack.push(sboocpsEndCont);
  const outcome = sboocpsInvoke(false, macro, args);
  if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
  const expansion = outcome.primaryValue();
  if (optimizeMacroCalls) {
    alterForm(form, expansion);
  }
  return sboocpsEvalForm(expansion, lenv);
}

function sboocpsEvalFunctionCall(mv, apply, operatorForm, operandForms, lenv) {
  sboocpsStack.push(new SBOOCPSFunctionCallOperatorFormCont(mv, apply, operandForms, lenv));
  return sboocpsEvalOperatorForm(operatorForm, lenv);
}

function sboocpsEvalOperatorForm(operatorForm, lenv) {
  if (operatorForm instanceof EVLVariable) {
    return sboocpsStack.invoke(lenv.ref(FUN_NS, operatorForm));
  } else {
    return sboocpsEvalForm(operatorForm, lenv);
  }
}

class SBOOCPSFunctionCallOperatorFormCont extends SBOOCPSCont {
  constructor(mv, apply, operandForms, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.operandForms = operandForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, operandForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return sboocpsStack.invoke(new OperatorFormTypeError());
    }
    return sboocpsEvalOperandForms(mv, apply, fn, operandForms, [], lenv);
  }
}

function sboocpsEvalOperandForms(mv, apply, fn, operandForms, args, lenv) {
  if (operandForms === EVLEmptyList.NIL) {
    return sboocpsInvoke(apply, fn, args);
  } else {
    sboocpsStack.push(new SBOOCPSFunctionCallOperandFormCont(mv, apply, fn, operandForms, args, lenv));
    return sboocpsEvalForm(operandForms.car, lenv);
  }
}

class SBOOCPSFunctionCallOperandFormCont extends SBOOCPSCont {
  constructor(mv, apply, fn, operandForms, args, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.fn = fn;
    this.operandForms = operandForms;
    this.args = args;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, fn, operandForms, args, lenv} = this;
    if (isAbruptCompletion(outcome)) return sboocpsStack.invoke(outcome);
    if (mv) {
      outcome.allValues().forEach(value => args.push(value));
    } else {
      args.push(outcome.primaryValue());
    }
    return sboocpsEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv);
  }
}

function sboocpsInvoke(apply, fn, args) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return sboocpsStack.invoke(values);
    return sboocpsStack.invoke(fn.jsFunction(values));
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return sboocpsStack.invoke(values);
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return sboocpsEvalSerialForms(fn.serialForms, elenv);
      case DYN_SCOPE:
        sboocpsStack.push(new Frame(fn.namespace, fn.parameters, values, null));
        return sboocpsEvalSerialForms(fn.serialForms, fn.lenv);
      default:
        throw new CannotHappen('sboocpsInvoke');
    }
  } else {
    throw new CannotHappen('sboocpsInvoke');
  }
}

/************************/
/* Trampoline Evaluator */
/************************/

let trampolineStack = null;

class TrampolineStack {
  constructor() {
    this.stack = [trampolineEndCont]; // array of TrampolineCont's and/or Frame's
    this.denv = nullDefiniteEnv;
  }
  push(element) {
    if (element instanceof TrampolineCont) {
      this.stack.push(element);
    } else if (element instanceof Frame) {
      this.stack.push(element);
      element.next = this.denv;
      this.denv = element;
    } else {
      throw new CannotHappen('TrampolineStack.push');
    }
  }
}

function trampolineEval(form) {
  trampolineStack = new TrampolineStack();
  let bounce = new EvalReq(form, nullDefiniteEnv);
  while (true) {
    if (abortSignalArray !== null && abortSignalArray[0] === 1) {
      throw new Aborted();
    }
    if (bounce instanceof EvalReq) {
      bounce = trampolineEvalForm(bounce.form, bounce.lenv);
    } else if (bounce instanceof Outcome) {
      while (true) {
        const element = trampolineStack.stack.pop();
        if (element instanceof TrampolineEndCont) {
          return element.invoke(bounce);
        } else if (element instanceof TrampolineCont) {
          bounce = element.invoke(bounce);
          break;
        } else if (element instanceof Frame) {
          trampolineStack.denv = element.next;
        } else {
          throw new CannotHappen('trampolineEval');
        }
      }
    } else {
      throw new CannotHappen('trampolineEval');
    }
  }
}

function trampolineEvalForm(form, lenv) {
  if (form instanceof EVLEmptyList) {
    return new EmptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return trampolineEvalQuote(form, lenv);
      case prognVariable:
        return trampolineEvalProgn(form, lenv);
      case ifVariable:
        return trampolineEvalIf(form, lenv);
      case _forEachVariable:
        return trampolineEvalForEach(form, lenv);
      case _vlambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, VAL_NS, false, form, lenv);
      case _mlambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, VAL_NS, true, form, lenv);
      case _flambdaVariable:
        return trampolineEvalLambda(LEX_SCOPE, FUN_NS, false, form, lenv);
      case _dlambdaVariable:
        return trampolineEvalLambda(DYN_SCOPE, VAL_NS, false, form, lenv);
      case vrefVariable:
        return trampolineEvalRef(LEX_SCOPE, VAL_NS, form, lenv);
      case vsetVariable:
        return trampolineEvalSet(LEX_SCOPE, VAL_NS, form, lenv);
      case frefVariable:
        return trampolineEvalRef(LEX_SCOPE, FUN_NS, form, lenv);
      case fsetVariable:
        return trampolineEvalSet(LEX_SCOPE, FUN_NS, form, lenv);
      case drefVariable:
        return trampolineEvalRef(DYN_SCOPE, VAL_NS, form, lenv);
      case dsetVariable:
        return trampolineEvalSet(DYN_SCOPE, VAL_NS, form, lenv);
      case blockVariable:
        return trampolineEvalBlock(form, lenv);
      case returnFromVariable:
        return trampolineEvalReturnFrom(form, lenv);
      case catchVariable:
        return trampolineEvalCatch(form, lenv);
      case throwVariable:
        return trampolineEvalThrow(form, lenv);
      case _handlerBindVariable:
        return trampolineEvalHandlerBind(form, lenv);
      case unwindProtectVariable:
        return trampolineEvalUnwindProtect(form, lenv);
      case applyVariable:
        return trampolineEvalCall(false, true, form, lenv);
      case multipleValueCallVariable:
        return trampolineEvalCall(true, false, form, lenv);
      case multipleValueApplyVariable:
        return trampolineEvalCall(true, true, form, lenv);
      default:
        return trampolineEvalCall(false, false, form, lenv);
    }
  } else if (form instanceof EVLVariable) {
    return lenv.ref(VAL_NS, form);
  } else {
    return form;
  }
}

class TrampolineCont { // abstract class
  constructor() {
  }
}

class TrampolineEndCont extends TrampolineCont {
  constructor() {
    super();
  }
  invoke(outcome) {
    return outcome;
  }
}

const trampolineEndCont = new TrampolineEndCont();

function trampolineEvalQuote(form, lenv) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return analysis;
  const [literal] = analysis;
  return literal;
}

function trampolineEvalProgn(form, lenv) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return analysis;
  const [serialForms] = analysis;
  return trampolineEvalSerialForms(serialForms, lenv);
}

function trampolineEvalSerialForms(serialForms, lenv) {
  if (serialForms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else {
    return trampolineEvalSerialFormForms(serialForms, lenv);
  }
}

function trampolineEvalSerialFormForms(serialForms, lenv) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return new EvalReq(serialForms.car, lenv);
  } else {
    trampolineStack.push(new TrampolineSerialFormCont(serialForms, lenv));
    return new EvalReq(serialForms.car, lenv);
  }
}

class TrampolineSerialFormCont extends TrampolineCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return trampolineEvalSerialFormForms(serialForms.cdr, lenv);
  }
}

function trampolineEvalIf(form, lenv) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return analysis;
  const [testForm, thenForm, elseForm] = analysis;
  trampolineStack.push(new TrampolineIfTestFormCont(thenForm, elseForm, lenv));
  return new EvalReq(testForm, lenv);
}

class TrampolineIfTestFormCont extends TrampolineCont {
  constructor(thenForm, elseForm, lenv) {
    super();
    this.thenForm = thenForm;
    this.elseForm = elseForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {thenForm, elseForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const test = outcome.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return new EvalReq(thenForm, lenv);
      case EVLBoolean.FALSE:
        return new EvalReq(elseForm, lenv);
      default:
        return new TestFormTypeError();
    }
  }
}

function trampolineEvalForEach(form, lenv) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return analysis;
  const [functionForm, listForm] = analysis;
  return new ForEachNotImplemented();
}

function trampolineEvalLambda(scope, namespace, macro, form, lenv) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return analysis;
  const [parameters, rest, serialForms] = analysis;
  return new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv);
}

function trampolineEvalRef(scope, namespace, form, lenv) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return analysis;
  const [variable] = analysis;
  switch (scope) {
    case LEX_SCOPE:
      return lenv.ref(namespace, variable);
    case DYN_SCOPE:
      return trampolineStack.denv.ref(namespace, variable);
    default:
      throw new CannotHappen('trampolineEvalRef');
  }
}

function trampolineEvalSet(scope, namespace, form, lenv) {
  const analysis = analyzeSet(form);
  if (isError(analysis)) return analysis;
  const [variable, valueForm] = analysis;
  trampolineStack.push(new TrampolineSetValueFormCont(scope, namespace, variable, lenv));
  return new EvalReq(valueForm, lenv);
}

class TrampolineSetValueFormCont extends TrampolineCont {
  constructor(scope, namespace, variable, lenv) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.variable = variable;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {scope, namespace, variable, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const value = outcome.primaryValue()
    switch (scope) {
      case LEX_SCOPE:
        return lenv.set(namespace, variable, value);
      case DYN_SCOPE:
        return trampolineStack.denv.set(namespace, variable, value);
      default:
        throw new CannotHappen('TrampolineSetValueFormCont.invoke');
    }
  }
}

function trampolineEvalBlock(form, lenv) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return analysis;
  const [blockName, serialForms] = analysis;
  const exitTag = new EVLVariable('exit-tag');
  const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
  trampolineStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
  trampolineStack.push(new TrampolineBlockSerialFormsCont(exitTag));
  return trampolineEvalSerialForms(serialForms, elenv);
}

class TrampolineBlockSerialFormsCont extends TrampolineCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return outcome.values;
    } else {
      return outcome;
    }
  }
}

function trampolineEvalReturnFrom(form, lenv) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return analysis;
  const [blockName, valuesForm] = analysis;
  const exitTag = lenv.ref(BLK_NS, blockName);
  if (exitTag === null) {
    return new NoBlock(blockName);
  }
  const exitPoint = trampolineStack.denv.ref(XIT_NS, exitTag);
  if (exitPoint === null) {
    return new NoBlockExitPoint(blockName);
  }
  trampolineStack.push(new TrampolineReturnFromValuesFormCont(exitTag));
  return new EvalReq(valuesForm, lenv);
}

class TrampolineReturnFromValuesFormCont extends TrampolineCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return new NonlocalExit(exitTag, outcome);
  }
}

function trampolineEvalCatch(form, lenv) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, serialForms] = analysis;
  trampolineStack.push(new TrampolineCatchExitTagFormCont(serialForms, lenv));
  return new EvalReq(exitTagForm, lenv);
}

class TrampolineCatchExitTagFormCont extends TrampolineCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return new ExitTagFormTypeError();
    }
    trampolineStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
    trampolineStack.push(new TrampolineCatchSerialFormsCont(exitTag));
    return trampolineEvalSerialForms(serialForms, lenv);
  }
}

class TrampolineCatchSerialFormsCont extends TrampolineCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return outcome.values;
    } else {
      return outcome;
    }
  }
}

function trampolineEvalThrow(form, lenv) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, valuesForm] = analysis;
  trampolineStack.push(new TrampolineThrowExitTagFormCont(valuesForm, lenv));
  return new EvalReq(exitTagForm, lenv);
}

class TrampolineThrowExitTagFormCont extends TrampolineCont {
  constructor(valuesForm, lenv) {
    super();
    this.valuesForm = valuesForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {valuesForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return new ExitTagFormTypeError();
    }
    const exitPoint = trampolineStack.denv.ref(XIT_NS, exitTag);
    if (exitPoint === null) {
      return new NoCatchExitPoint(exitTag);
    }
    trampolineStack.push(new TrampolineThrowValuesFormCont(exitTag));
    return new EvalReq(valuesForm, lenv);
  }
}

class TrampolineThrowValuesFormCont extends TrampolineCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return new NonlocalExit(exitTag, outcome);
  }
}

function trampolineEvalHandlerBind(form, lenv) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return analysis;
  const [handlerForm, serialForms] = analysis;
  trampolineStack.push(new TrampolineHandlerBindHandlerFormCont(serialForms, lenv));
  return new EvalReq(handlerForm, lenv);
}

class TrampolineHandlerBindHandlerFormCont extends TrampolineCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const handler = outcome.primaryValue();
    if (!(handler instanceof EVLFunction)) {
      return new HandlerFormTypeError();
    }
    trampolineStack.push(new TrampolineHandlerBindSerialFormsCont(handler));
    return trampolineEvalSerialForms(serialForms, lenv);
  }
}

class TrampolineHandlerBindSerialFormsCont extends TrampolineCont {
  constructor(handler) {
    super();
    this.handler = handler;
  }
  invoke(outcome) {
    const {handler} = this;
    if (isError(outcome)) {
      trampolineStack.push(new TrampolineHandlerBindInvocationCont(outcome));
      return trampolineInvoke(false, handler, [outcome.category, outcome.description]);
    } else {
      return outcome;
    }
  }
}

class TrampolineHandlerBindInvocationCont extends TrampolineCont {
  constructor(serialFormsOutcome) {
    super();
    this.serialFormsOutcome = serialFormsOutcome;
  }
  invoke(outcome) {
    const {serialFormsOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return outcome;
    } else {
      return serialFormsOutcome;
    }
  }
}

function trampolineEvalUnwindProtect(form, lenv) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return analysis;
  const [protectedForm, cleanupForms] = analysis;
  trampolineStack.push(new TrampolineUnwindProtectProtectedFormCont(cleanupForms, lenv));
  return new EvalReq(protectedForm, lenv);
}

class TrampolineUnwindProtectProtectedFormCont extends TrampolineCont {
  constructor(cleanupForms, lenv) {
    super();
    this.cleanupForms = cleanupForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {cleanupForms, lenv} = this;
    trampolineStack.push(new TrampolineUnwindProtectCleanupFormsCont(outcome));
    return trampolineEvalSerialForms(cleanupForms, lenv);
  }
}

class TrampolineUnwindProtectCleanupFormsCont extends TrampolineCont {
  constructor(protectedFormOutcome) {
    super();
    this.protectedFormOutcome = protectedFormOutcome;
  }
  invoke(outcome) {
    const {protectedFormOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return outcome;
    } else {
      return protectedFormOutcome;
    }
  }
}

function trampolineEvalCall(mv, apply, form, lenv) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return analysis;
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return trampolineEvalMacroCall(form, operator, operands, lenv);
  } else {
    return trampolineEvalFunctionCall(mv, apply, operator, operands, lenv);
  }
}

function trampolineEvalMacroCall(form, macro, macroOperands, lenv) {
  const args = listToArray(macroOperands);
  trampolineStack.push(new TrampolineMacroCont(form, lenv));
  return trampolineInvoke(false, macro, args);
}

class TrampolineMacroCont extends TrampolineCont {
  constructor(form, lenv) {
    super();
    this.form = form;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {form, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const expansion = outcome.primaryValue();
    if (optimizeMacroCalls) {
      alterForm(form, expansion);
    }
    return new EvalReq(expansion, lenv);
  }
}

function trampolineEvalFunctionCall(mv, apply, operatorForm, operandForms, lenv) {
  trampolineStack.push(new TrampolineFunctionCallOperatorFormCont(mv, apply, operandForms, lenv));
  return trampolineEvalOperatorForm(operatorForm, lenv);
}

function trampolineEvalOperatorForm(operatorForm, lenv) {
  if (operatorForm instanceof EVLVariable) {
    return lenv.ref(FUN_NS, operatorForm);
  } else {
    return new EvalReq(operatorForm, lenv);
  }
}

class TrampolineFunctionCallOperatorFormCont extends TrampolineCont {
  constructor(mv, apply, operandForms, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.operandForms = operandForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, operandForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return new OperatorFormTypeError();
    }
    return trampolineEvalOperandForms(mv, apply, fn, operandForms, [], lenv);
  }
}

function trampolineEvalOperandForms(mv, apply, fn, operandForms, args, lenv) {
  if (operandForms === EVLEmptyList.NIL) {
    return trampolineInvoke(apply, fn, args);
  } else {
    trampolineStack.push(new TrampolineFunctionCallOperandFormCont(mv, apply, fn, operandForms, args, lenv));
    return new EvalReq(operandForms.car, lenv);
  }
}

class TrampolineFunctionCallOperandFormCont extends TrampolineCont {
  constructor(mv, apply, fn, operandForms, args, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.fn = fn;
    this.operandForms = operandForms;
    this.args = args;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, fn, operandForms, args, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    if (mv) {
      outcome.allValues().forEach(value => args.push(value));
    } else {
      args.push(outcome.primaryValue());
    }
    return trampolineEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv);
  }
}

function trampolineInvoke(apply, fn, args) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return values;
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return values;
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return trampolineEvalSerialForms(fn.serialForms, elenv);
      case DYN_SCOPE:
        trampolineStack.push(new Frame(fn.namespace, fn.parameters, values, null));
        return trampolineEvalSerialForms(fn.serialForms, fn.lenv);
      default:
        throw new CannotHappen('trampolineInvoke');
    }
  } else {
    throw new CannotHappen('trampolineInvoke');
  }
}

/**************************/
/* Trampoline++ Evaluator */
/**************************/

let trampolineppStack = null;

class TrampolineppStack {
  constructor() {
    this.stack = [trampolineppEndCont]; // array of TrampolineppCont's and/or Frame's
    this.denv = nullDefiniteEnv;
  }
  push(element) {
    if (element instanceof TrampolineppCont) {
      this.stack.push(element);
    } else if (element instanceof Frame) {
      this.stack.push(element);
      element.next = this.denv;
      this.denv = element;
    } else {
      throw new CannotHappen('TrampolineppStack.push');
    }
  }
}

function trampolineppEval(form, lenv = null) {
  if (lenv === null) {
    form = trampolineppPreprocessForm(form, nullDefiniteEnv);
    if (isAbruptCompletion(form)) return form;
    lenv = nullDefiniteEnv;
  }
  trampolineppStack = new TrampolineppStack();
  let bounce = new EvalReq(form, lenv);
  while (true) {
    if (abortSignalArray !== null && abortSignalArray[0] === 1) {
      throw new Aborted();
    }
    if (bounce instanceof EvalReq) {
      bounce = bounce.form.eval(bounce.lenv);
    } else if (bounce instanceof Outcome) {
      while (true) {
        const element = trampolineppStack.stack.pop();
        if (element instanceof TrampolineppEndCont) {
          return element.invoke(bounce);
        } else if (element instanceof TrampolineppCont) {
          bounce = element.invoke(bounce);
          break;
        } else if (element instanceof Frame) {
          trampolineppStack.denv = element.next;
        } else {
          throw new CannotHappen('trampolineppEval');
        }
      }
    } else {
      throw new CannotHappen('trampolineppEval');
    }
  }
}

function trampolineppPreprocessForm(form, lenv) {
  if (form instanceof EVLEmptyList) {
    return new EmptyListError();
  } else if (form instanceof EVLCons) {
    switch (form.car) {
      case quoteVariable:
        return trampolineppPreprocessQuote(form, lenv);
      case prognVariable:
        return trampolineppPreprocessProgn(form, lenv);
      case ifVariable:
        return trampolineppPreprocessIf(form, lenv);
      case _forEachVariable:
        return trampolineppPreprocessForEach(form, lenv);
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
      case blockVariable:
        return trampolineppPreprocessBlock(form, lenv);
      case returnFromVariable:
        return trampolineppPreprocessReturnFrom(form, lenv);
      case catchVariable:
        return trampolineppPreprocessCatch(form, lenv);
      case throwVariable:
        return trampolineppPreprocessThrow(form, lenv);
      case _handlerBindVariable:
        return trampolineppPreprocessHandlerBind(form, lenv);
      case unwindProtectVariable:
        return trampolineppPreprocessUnwindProtect(form, lenv);
      case mletVariable:
        return trampolineppPreprocessMlet(form, lenv);
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
    return trampolineppPreprocessAnalyzedRef(LEX_SCOPE, VAL_NS, form, lenv);
  } else {
    return trampolineppPreprocessAnalyzedQuote(form, lenv);
  }
}

function trampolineppPreprocessForms(forms, lenv) {
  if (forms === EVLEmptyList.NIL) {
    return EVLEmptyList.NIL;
  } else {
    const preprocessedForm = trampolineppPreprocessForm(forms.car, lenv);
    if (isAbruptCompletion(preprocessedForm)) return preprocessedForm;
    const preprocessedForms = trampolineppPreprocessForms(forms.cdr, lenv);
    if (isAbruptCompletion(preprocessedForms)) return preprocessedForms;
    return new EVLCons(preprocessedForm, preprocessedForms);
  }
}

class TrampolineppCont { // abstract class
  constructor() {
  }
}

class TrampolineppEndCont extends TrampolineppCont {
  constructor() {
    super();
  }
  invoke(outcome) {
    return outcome;
  }
}

const trampolineppEndCont = new TrampolineppEndCont();

class TrampolineppForm { // abstract class
}

function trampolineppPreprocessQuote(form, lenv) {
  const analysis = analyzeQuote(form);
  if (isError(analysis)) return analysis;
  const [literal] = analysis;
  return trampolineppPreprocessAnalyzedQuote(literal, lenv);
}

function trampolineppPreprocessAnalyzedQuote(literal, lenv) {
  return new TrampolineppQuote(literal);
}

class TrampolineppQuote extends TrampolineppForm {
  constructor(literal) {
    super();
    this.literal = literal;
  }
  eval(lenv) {
    const {literal} = this;
    return literal;
  }
}

function trampolineppPreprocessProgn(form, lenv) {
  const analysis = analyzeProgn(form);
  if (isError(analysis)) return analysis;
  const [serialForms] = analysis;
  const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, lenv);
  if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
  return new TrampolineppProgn(preprocessedSerialForms);
}

class TrampolineppProgn extends TrampolineppForm {
  constructor(serialForms) {
    super();
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {serialForms} = this;
    return trampolineppEvalSerialForms(serialForms, lenv);
  }
}

function trampolineppEvalSerialForms(serialForms, lenv) {
  if (serialForms === EVLEmptyList.NIL) {
    return EVLVoid.VOID;
  } else {
    return trampolineppEvalSerialFormForms(serialForms, lenv);
  }
}

function trampolineppEvalSerialFormForms(serialForms, lenv) {
  if (serialForms.cdr === EVLEmptyList.NIL) {
    return new EvalReq(serialForms.car, lenv);
  } else {
    trampolineppStack.push(new TrampolineppSerialFormCont(serialForms, lenv));
    return new EvalReq(serialForms.car, lenv);
  }
}

class TrampolineppSerialFormCont extends TrampolineppCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return trampolineppEvalSerialFormForms(serialForms.cdr, lenv);
  }
}

function trampolineppPreprocessIf(form, lenv) {
  const analysis = analyzeIf(form);
  if (isError(analysis)) return analysis;
  const [testForm, thenForm, elseForm] = analysis;
  const preprocessedTestForm = trampolineppPreprocessForm(testForm, lenv);
  if (isAbruptCompletion(preprocessedTestForm)) return preprocessedTestForm;
  const preprocessedThenForm = trampolineppPreprocessForm(thenForm, lenv);
  if (isAbruptCompletion(preprocessedThenForm)) return preprocessedThenForm;
  const preprocessedElseForm = trampolineppPreprocessForm(elseForm, lenv);
  if (isAbruptCompletion(preprocessedElseForm)) return preprocessedElseForm;
  return new TrampolineppIf(preprocessedTestForm, preprocessedThenForm, preprocessedElseForm);
}

class TrampolineppIf extends TrampolineppForm {
  constructor(testForm, thenForm, elseForm) {
    super();
    this.testForm = testForm;
    this.thenForm = thenForm;
    this.elseForm = elseForm;
  }
  eval(lenv) {
    const {testForm, thenForm, elseForm} = this;
    trampolineppStack.push(new TrampolineppIfTestFormCont(thenForm, elseForm, lenv));
    return new EvalReq(testForm, lenv);
  }
}

class TrampolineppIfTestFormCont extends TrampolineppCont {
  constructor(thenForm, elseForm, lenv) {
    super();
    this.thenForm = thenForm;
    this.elseForm = elseForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {thenForm, elseForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const test = outcome.primaryValue();
    switch (test) {
      case EVLBoolean.TRUE:
        return new EvalReq(thenForm, lenv);
      case EVLBoolean.FALSE:
        return new EvalReq(elseForm, lenv);
      default:
        return new TestFormTypeError();
    }
  }
}

function trampolineppPreprocessForEach(form, lenv) {
  const analysis = analyzeForEach(form);
  if (isError(analysis)) return analysis;
  const [functionForm, listForm] = analysis;
  const preprocessedFunctionForm = trampolineppPreprocessForm(functionForm, lenv);
  if (isAbruptCompletion(preprocessedFunctionForm)) return preprocessedFunctionForm;
  const preprocessedListForm = trampolineppPreprocessForm(listForm, lenv);
  if (isAbruptCompletion(preprocessedListForm)) return preprocessedListForm;
  return new TrampolineppForEach(preprocessedFunctionForm, preprocessedListForm);
}

class TrampolineppForEach extends TrampolineppForm {
  constructor(functionForm, listForm) {
    super();
    this.functionForm = functionForm;
    this.listForm = listForm;
  }
  eval(lenv) {
    const {functionForm, listForm} = this;
    return new ForEachNotImplemented();
  }
}

function trampolineppPreprocessLambda(scope, namespace, macro, form, lenv) {
  const analysis = analyzeLambda(form);
  if (isError(analysis)) return analysis;
  const [parameters, rest, serialForms] = analysis;
  switch (scope) {
    case LEX_SCOPE: {
      const elenv = new Frame(namespace, parameters, new Array(parameters.length).fill(null), lenv);
      const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, elenv);
      if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
      return new TrampolineppLambda(scope, namespace, macro, parameters, rest, preprocessedSerialForms);
    }
    case DYN_SCOPE: {
      const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, lenv);
      if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
      return new TrampolineppLambda(scope, namespace, macro, parameters, rest, preprocessedSerialForms);
    }
    default:
      throw new CannotHappen('trampolineppPreprocessLambda');
  }
}

class TrampolineppLambda extends TrampolineppForm {
  constructor(scope, namespace, macro, parameters, rest, serialForms) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.parameters = parameters;
    this.rest = rest;
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {scope, namespace, macro, parameters, rest, serialForms} = this;
    return new EVLClosure(scope, namespace, macro, parameters, rest, serialForms, lenv);
  }
}

function trampolineppPreprocessRef(scope, namespace, form, lenv) {
  const analysis = analyzeRef(form);
  if (isError(analysis)) return analysis;
  const [variable] = analysis;
  return trampolineppPreprocessAnalyzedRef(scope, namespace, variable, lenv);
}

function trampolineppPreprocessAnalyzedRef(scope, namespace, variable, lenv) {
  switch (scope) {
    case LEX_SCOPE:
      const [global, i, j] = lenv.lookup(namespace, variable, 0);
      if (global) {
        return new TrampolineppGRef(namespace, variable);
      } else {
        return new TrampolineppLRef(i, j);
      }
    case DYN_SCOPE:
      return new TrampolineppDRef(namespace, variable);
    default:
      throw new CannotHappen('trampolineppPreprocessAnalyzedRef');
  }
}

class TrampolineppGRef extends TrampolineppForm {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  eval(lenv) {
    const {namespace, variable} = this;
    return GlobalEnv.ref(namespace, variable);
  }
}

class TrampolineppLRef extends TrampolineppForm {
  constructor(i, j) {
    super();
    this.i = i;
    this.j = j;
  }
  eval(lenv) {
    const {i, j} = this;
    let frame = lenv;
    for (let n = i; n > 0; n--) {
      frame = frame.next;
    }
    return frame.values[j];
  }
}

class TrampolineppDRef extends TrampolineppForm {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  eval(lenv) {
    const {namespace, variable} = this;
    return trampolineppStack.denv.ref(namespace, variable);
  }
}

function trampolineppPreprocessSet(scope, namespace, form, lenv) {
  const analysis = analyzeSet(form);
  if (isError(analysis)) return analysis;
  const [variable, valueForm] = analysis;
  const preprocessedValueForm = trampolineppPreprocessForm(valueForm, lenv);
  if (isAbruptCompletion(preprocessedValueForm)) return preprocessedValueForm;
  switch (scope) {
    case LEX_SCOPE:
      const [global, i, j] = lenv.lookup(namespace, variable, 0);
      if (global) {
        return new TrampolineppGSet(namespace, variable, preprocessedValueForm);
      } else {
        return new TrampolineppLSet(i, j, preprocessedValueForm);
      }
    case DYN_SCOPE:
      return new TrampolineppDSet(namespace, variable, preprocessedValueForm);
    default:
      throw new CannotHappen('trampolineppPreprocessSet');
  }
}

class TrampolineppGSet extends TrampolineppForm {
  constructor(namespace, variable, valueForm) {
    super();
    this.namespace = namespace;
    this.variable = variable;
    this.valueForm = valueForm;
  }
  eval(lenv) {
    const {namespace, variable, valueForm} = this;
    trampolineppStack.push(new TrampolineppGSetValueFormCont(namespace, variable));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppGSetValueFormCont extends TrampolineppCont {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(outcome) {
    const {namespace, variable} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const value = outcome.primaryValue();
    return GlobalEnv.set(namespace, variable, value);
  }
}

class TrampolineppLSet extends TrampolineppForm {
  constructor(i, j, valueForm) {
    super();
    this.i = i;
    this.j = j;
    this.valueForm = valueForm;
  }
  eval(lenv) {
    const {i, j, valueForm} = this;
    trampolineppStack.push(new TrampolineppLSetValueFormCont(i, j, lenv));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppLSetValueFormCont extends TrampolineppCont {
  constructor(i, j, lenv) {
    super();
    this.i = i;
    this.j = j;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {i, j, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const value = outcome.primaryValue();
    let frame = lenv;
    for (let n = i; n > 0; n--) {
      frame = frame.next;
    }
    return frame.values[j] = value;
  }
}

class TrampolineppDSet extends TrampolineppForm {
  constructor(namespace, variable, valueForm) {
    super();
    this.namespace = namespace;
    this.variable = variable;
    this.valueForm = valueForm;
  }
  eval(lenv) {
    const {namespace, variable, valueForm} = this;
    trampolineppStack.push(new TrampolineppDSetValueFormCont(namespace, variable));
    return new EvalReq(valueForm, lenv);
  }
}

class TrampolineppDSetValueFormCont extends TrampolineppCont {
  constructor(namespace, variable) {
    super();
    this.namespace = namespace;
    this.variable = variable;
  }
  invoke(outcome) {
    const {namespace, variable} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const value = outcome.primaryValue();
    return trampolineppStack.denv.set(namespace, variable, value);
  }
}

function trampolineppPreprocessBlock(form, lenv) {
  const analysis = analyzeBlock(form);
  if (isError(analysis)) return analysis;
  const [blockName, serialForms] = analysis;
  const elenv = new Frame(BLK_NS, [blockName], [null], lenv);
  const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, elenv);
  if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
  return new TrampolineppBlock(blockName, preprocessedSerialForms);
}

class TrampolineppBlock extends TrampolineppForm {
  constructor(blockName, serialForms) {
    super();
    this.blockName = blockName;
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {blockName, serialForms} = this;
    const exitTag = new EVLVariable('exit-tag');
    const elenv = new Frame(BLK_NS, [blockName], [exitTag], lenv);
    trampolineppStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
    trampolineppStack.push(new TrampolineppBlockSerialFormsCont(exitTag));
    return trampolineppEvalSerialForms(serialForms, elenv);
  }
}

class TrampolineppBlockSerialFormsCont extends TrampolineppCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return outcome.values;
    } else {
      return outcome;
    }
  }
}

function trampolineppPreprocessReturnFrom(form, lenv) {
  const analysis = analyzeReturnFrom(form);
  if (isError(analysis)) return analysis;
  const [blockName, valuesForm] = analysis;
  const preprocessedValuesForm = trampolineppPreprocessForm(valuesForm, lenv);
  if (isAbruptCompletion(preprocessedValuesForm)) return preprocessedValuesForm;
  return new TrampolineppReturnFrom(blockName, preprocessedValuesForm);
}

class TrampolineppReturnFrom extends TrampolineppForm {
  constructor(blockName, valuesForm) {
    super();
    this.blockName = blockName;
    this.valuesForm = valuesForm;
  }
  eval(lenv) {
    const {blockName, valuesForm} = this;
    const exitTag = lenv.ref(BLK_NS, blockName);
    if (exitTag === null) {
      return new NoBlock(blockName);
    }
    const exitPoint = trampolineppStack.denv.ref(XIT_NS, exitTag);
    if (exitPoint === null) {
      return new NoBlockExitPoint(blockName);
    }
    trampolineppStack.push(new TrampolineppReturnFromValuesFormCont(exitTag));
    return new EvalReq(valuesForm, lenv);
  }
}

class TrampolineppReturnFromValuesFormCont extends TrampolineppCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return new NonlocalExit(exitTag, outcome);
  }
}

function trampolineppPreprocessCatch(form, lenv) {
  const analysis = analyzeCatch(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, serialForms] = analysis;
  const preprocessedExitTagForm = trampolineppPreprocessForm(exitTagForm, lenv);
  if (isAbruptCompletion(preprocessedExitTagForm)) return preprocessedExitTagForm;
  const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, lenv);
  if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
  return new TrampolineppCatch(preprocessedExitTagForm, preprocessedSerialForms);
}

class TrampolineppCatch extends TrampolineppForm {
  constructor(exitTagForm, serialForms) {
    super();
    this.exitTagForm = exitTagForm;
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {exitTagForm, serialForms} = this;
    trampolineppStack.push(new TrampolineppCatchExitTagFormCont(serialForms, lenv));
    return new EvalReq(exitTagForm, lenv);
  }
}

class TrampolineppCatchExitTagFormCont extends TrampolineppCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return new ExitTagFormTypeError();
    }
    trampolineppStack.push(new Frame(XIT_NS, [exitTag], [EVLVoid.VOID], null));
    trampolineppStack.push(new TrampolineppCatchSerialFormsCont(exitTag));
    return trampolineppEvalSerialForms(serialForms, lenv);
  }
}

class TrampolineppCatchSerialFormsCont extends TrampolineppCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isNonlocalExit(outcome) && outcome.exitTag === exitTag) {
      return outcome.values;
    } else {
      return outcome;
    }
  }
}

function trampolineppPreprocessThrow(form, lenv) {
  const analysis = analyzeThrow(form);
  if (isError(analysis)) return analysis;
  const [exitTagForm, valuesForm] = analysis;
  const preprocessedExitTagForm = trampolineppPreprocessForm(exitTagForm, lenv);
  if (isAbruptCompletion(preprocessedExitTagForm)) return preprocessedExitTagForm;
  const preprocessedValuesForm = trampolineppPreprocessForm(valuesForm, lenv);
  if (isAbruptCompletion(preprocessedValuesForm)) return preprocessedValuesForm;
  return new TrampolineppThrow(preprocessedExitTagForm, preprocessedValuesForm);
}

class TrampolineppThrow extends TrampolineppForm {
  constructor(exitTagForm, valuesForm) {
    super();
    this.exitTagForm = exitTagForm;
    this.valuesForm = valuesForm;
  }
  eval(lenv) {
    const {exitTagForm, valuesForm} = this;
    trampolineppStack.push(new TrampolineppThrowExitTagFormCont(valuesForm, lenv));
    return new EvalReq(exitTagForm, lenv);
  }
}

class TrampolineppThrowExitTagFormCont extends TrampolineppCont {
  constructor(valuesForm, lenv) {
    super();
    this.valuesForm = valuesForm;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {valuesForm, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const exitTag = outcome.primaryValue();
    if (!(exitTag instanceof EVLVariable)) {
      return new ExitTagFormTypeError();
    }
    const exitPoint = trampolineppStack.denv.ref(XIT_NS, exitTag);
    if (exitPoint === null) {
      return new NoCatchExitPoint(exitTag);
    }
    trampolineppStack.push(new TrampolineppThrowValuesFormCont(exitTag));
    return new EvalReq(valuesForm, lenv);
  }
}

class TrampolineppThrowValuesFormCont extends TrampolineppCont {
  constructor(exitTag) {
    super();
    this.exitTag = exitTag;
  }
  invoke(outcome) {
    const {exitTag} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    return new NonlocalExit(exitTag, outcome);
  }
}

function trampolineppPreprocessHandlerBind(form, lenv) {
  const analysis = analyzeHandlerBind(form);
  if (isError(analysis)) return analysis;
  const [handlerForm, serialForms] = analysis;
  const preprocessedHandlerForm = trampolineppPreprocessForm(handlerForm, lenv);
  if (isAbruptCompletion(preprocessedHandlerForm)) return preprocessedHandlerForm;
  const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, lenv);
  if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
  return new TrampolineppHandlerBind(preprocessedHandlerForm, preprocessedSerialForms);
}

class TrampolineppHandlerBind extends TrampolineppForm {
  constructor(handlerForm, serialForms) {
    super();
    this.handlerForm = handlerForm;
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {handlerForm, serialForms} = this;
    trampolineppStack.push(new TrampolineppHandlerBindHandlerFormCont(serialForms, lenv));
    return new EvalReq(handlerForm, lenv);
  }
}

class TrampolineppHandlerBindHandlerFormCont extends TrampolineppCont {
  constructor(serialForms, lenv) {
    super();
    this.serialForms = serialForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {serialForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const handler = outcome.primaryValue();
    if (!(handler instanceof EVLFunction)) {
      return new HandlerFormTypeError();
    }
    trampolineppStack.push(new TrampolineppHandlerBindSerialFormsCont(handler));
    return trampolineppEvalSerialForms(serialForms, lenv);
  }
}

class TrampolineppHandlerBindSerialFormsCont extends TrampolineppCont {
  constructor(handler) {
    super();
    this.handler = handler;
  }
  invoke(outcome) {
    const {handler} = this;
    if (isError(outcome)) {
      trampolineppStack.push(new TrampolineppHandlerBindInvocationCont(outcome));
      return trampolineppInvoke(false, handler, [outcome.category, outcome.description]);
    } else {
      return outcome;
    }
  }
}

class TrampolineppHandlerBindInvocationCont extends TrampolineppCont {
  constructor(serialFormsOutcome) {
    super();
    this.serialFormsOutcome = serialFormsOutcome;
  }
  invoke(outcome) {
    const {serialFormsOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return outcome;
    } else {
      return serialFormsOutcome;
    }
  }
}

function trampolineppPreprocessUnwindProtect(form, lenv) {
  const analysis = analyzeUnwindProtect(form);
  if (isError(analysis)) return analysis;
  const [protectedForm, cleanupForms] = analysis;
  const preprocessedProtectedForm = trampolineppPreprocessForm(protectedForm, lenv);
  if (isAbruptCompletion(preprocessedProtectedForm)) return preprocessedProtectedForm;
  const preprocessedCleanupForms = trampolineppPreprocessForms(cleanupForms, lenv);
  if (isAbruptCompletion(preprocessedCleanupForms)) return preprocessedCleanupForms;
  return new TrampolineppUnwindProtect(preprocessedProtectedForm, preprocessedCleanupForms);
}

class TrampolineppUnwindProtect extends TrampolineppForm {
  constructor(protectedForm, cleanupForms) {
    super();
    this.protectedForm = protectedForm
    this.cleanupForms = cleanupForms;
  }
  eval(lenv) {
    const {protectedForm, cleanupForms} = this;
    trampolineppStack.push(new TrampolineppUnwindProtectProtectedFormCont(cleanupForms, lenv));
    return new EvalReq(protectedForm, lenv);
  }
}

class TrampolineppUnwindProtectProtectedFormCont extends TrampolineppCont {
  constructor(cleanupForms, lenv) {
    super();
    this.cleanupForms = cleanupForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {cleanupForms, lenv} = this;
    trampolineppStack.push(new TrampolineppUnwindProtectCleanupFormsCont(outcome));
    return trampolineppEvalSerialForms(cleanupForms, lenv);
  }
}

class TrampolineppUnwindProtectCleanupFormsCont extends TrampolineppCont {
  constructor(protectedFormOutcome) {
    super();
    this.protectedFormOutcome = protectedFormOutcome;
  }
  invoke(outcome) {
    const {protectedFormOutcome} = this;
    if (isAbruptCompletion(outcome)) {
      return outcome;
    } else {
      return protectedFormOutcome;
    }
  }
}

function trampolineppPreprocessMlet(form, lenv) {
  const analysis = analyzeMlet(form);
  if (isError(analysis)) return analysis;
  const [mletBindings, serialForms] = analysis;
  const variables = mletBindings.map(mletBinding => mletBinding[0]);
  const values = [];
  for (const mletBinding of mletBindings) {
    const [variable, parameterList, mlambdaSerialForms] = mletBinding;
    const mlambda = new EVLCons(mlambdaVariable, new EVLCons(parameterList, mlambdaSerialForms));
    const _mlambda = trampolineppPreprocessForm(mlambda, nullDefiniteEnv);
    if (isAbruptCompletion(_mlambda)) return _mlambda;
    if (!(_mlambda instanceof TrampolineppLambda) || !_mlambda.macro) {
      throw new CannotHappen('trampolineppPreprocessMlet');
    }
    values.push(_mlambda.eval(nullDefiniteEnv));
  }
  const elenv = new Frame(FUN_NS, variables, values, lenv);
  const preprocessedSerialForms = trampolineppPreprocessForms(serialForms, elenv);
  if (isAbruptCompletion(preprocessedSerialForms)) return preprocessedSerialForms;
  return new TrampolineppMlet(mletBindings, preprocessedSerialForms);
}

class TrampolineppMlet extends TrampolineppForm {
  constructor(mletBindings, serialForms) {
    super();
    this.mletBindings = mletBindings;
    this.serialForms = serialForms;
  }
  eval(lenv) {
    const {mletBindings, serialForms} = this;
    const variables = mletBindings.map(mletBinding => mletBinding[0]);
    const values = mletBindings.map(mletBinding => EVLVoid.VOID);
    const elenv = new Frame(FUN_NS, variables, values, lenv);
    return trampolineppEvalSerialForms(serialForms, elenv);
  }
}

function trampolineppPreprocessCall(mv, apply, form, lenv) {
  const analysis = analyzeCall(mv, apply, form, lenv);
  if (isError(analysis)) return analysis;
  const [macroCall, operator, operands] = analysis;
  if (macroCall) {
    return trampolineppPreprocessMacroCall(operator, operands, lenv);
  } else {
    return trampolineppPreprocessFunctionCall(mv, apply, operator, operands, lenv);
  }
}

function trampolineppPreprocessMacroCall(macro, macroOperands, lenv) {
  const args = listToArray(macroOperands);
  const values = pairClosureParameters(false, args, macro.parameters, macro.rest);
  if (isError(values)) return values;
  const elenv = new Frame(macro.namespace, macro.parameters, values, macro.lenv);
  const outcome = trampolineppEval(new TrampolineppProgn(macro.serialForms), elenv);
  if (isAbruptCompletion(outcome)) return outcome;
  const expansion = outcome.primaryValue();
  return trampolineppPreprocessForm(expansion, lenv);
}

function trampolineppPreprocessFunctionCall(mv, apply, operatorForm, operandForms, lenv) {
  const preprocessedOperatorForm = trampolineppPreprocessOperatorForm(operatorForm, lenv);
  if (isAbruptCompletion(preprocessedOperatorForm)) return preprocessedOperatorForm;
  const preprocessedOperandForms = trampolineppPreprocessForms(operandForms, lenv);
  if (isAbruptCompletion(preprocessedOperandForms)) return preprocessedOperandForms;
  return new TrampolineppFunctionCall(mv, apply, preprocessedOperatorForm, preprocessedOperandForms);
}

function trampolineppPreprocessOperatorForm(operatorForm, lenv) {
  if (operatorForm instanceof EVLVariable) {
    return trampolineppPreprocessAnalyzedRef(LEX_SCOPE, FUN_NS, operatorForm, lenv);
  } else {
    return trampolineppPreprocessForm(operatorForm, lenv);
  }
}

class TrampolineppFunctionCall extends TrampolineppForm {
  constructor(mv, apply, operatorForm, operandForms) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.operatorForm = operatorForm;
    this.operandForms = operandForms;
  }
  eval(lenv) {
    const {mv, apply, operatorForm, operandForms} = this;
    trampolineppStack.push(new TrampolineppFunctionCallOperatorFormCont(mv, apply, operandForms, lenv));
    return trampolineppEvalOperatorForm(operatorForm, lenv);
  }
}

function trampolineppEvalOperatorForm(operatorForm, lenv) {
  return new EvalReq(operatorForm, lenv);
}

class TrampolineppFunctionCallOperatorFormCont extends TrampolineppCont {
  constructor(mv, apply, operandForms, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.operandForms = operandForms;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, operandForms, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    const fn = outcome.primaryValue();
    if (!(fn instanceof EVLFunction)) {
      return new OperatorFormTypeError();
    }
    return trampolineppEvalOperandForms(mv, apply, fn, operandForms, [], lenv);
  }
}

function trampolineppEvalOperandForms(mv, apply, fn, operandForms, args, lenv) {
  if (operandForms === EVLEmptyList.NIL) {
    return trampolineppInvoke(apply, fn, args);
  } else {
    trampolineppStack.push(new TrampolineppFunctionCallOperandFormCont(mv, apply, fn, operandForms, args, lenv));
    return new EvalReq(operandForms.car, lenv);
  }
}

class TrampolineppFunctionCallOperandFormCont extends TrampolineppCont {
  constructor(mv, apply, fn, operandForms, args, lenv) {
    super();
    this.mv = mv;
    this.apply = apply;
    this.fn = fn;
    this.operandForms = operandForms;
    this.args = args;
    this.lenv = lenv;
  }
  invoke(outcome) {
    const {mv, apply, fn, operandForms, args, lenv} = this;
    if (isAbruptCompletion(outcome)) return outcome;
    if (mv) {
      outcome.allValues().forEach(value => args.push(value));
    } else {
      args.push(outcome.primaryValue());
    }
    return trampolineppEvalOperandForms(mv, apply, fn, operandForms.cdr, args, lenv);
  }
}

function trampolineppInvoke(apply, fn, args) {
  if (fn instanceof EVLPrimitiveFunction) {
    const values = pairPrimFunParameters(apply, args, fn.arityMin, fn.arityMax);
    if (isError(values)) return values;
    return fn.jsFunction(values);
  } else if (fn instanceof EVLClosure) {
    const values = pairClosureParameters(apply, args, fn.parameters, fn.rest);
    if (isError(values)) return values;
    switch (fn.scope) {
      case LEX_SCOPE:
        const elenv = new Frame(fn.namespace, fn.parameters, values, fn.lenv);
        return trampolineppEvalSerialForms(fn.serialForms, elenv);
      case DYN_SCOPE:
        trampolineppStack.push(new Frame(fn.namespace, fn.parameters, values, null));
        return trampolineppEvalSerialForms(fn.serialForms, fn.lenv);
      default:
        throw new CannotHappen('trampolineppInvoke');
    }
  } else {
    throw new CannotHappen('trampolineppInvoke');
  }
}

/**********************************/
/* Primitive Function Definitions */
/**********************************/

const primitiveFunctions = new Map();

function primitiveFunction(name, arityMin, arityMax, jsFunction) {
  primitiveFunctions.set(name, [arityMin, arityMax, jsFunction]);
}

function checkArgumentType(args, n, constructor) {
  const arg = args[n];
  if (arg instanceof constructor) {
    return arg;
  } else {
    return new ArgumentTypeError(n, constructor);
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

/***********/
/* Outcome */
/***********/

class Outcome extends Bounce { // abstract class
  constructor() {
    super();
  }
}

/*********************/
/* Abrupt Completion */
/*********************/

class AbruptCompletion extends Outcome { // abstract class
  constructor() {
    super();
  }
}

function isAbruptCompletion(outcome) {
  return outcome instanceof AbruptCompletion;
}

/***********************************/
/* Abrupt Completion of Type Error */
/***********************************/

class AbruptCompletionError extends AbruptCompletion {
  constructor(category, description) {
    super();
    this.category = ensureEVLString(category);
    this.description = ensureEVLString(description);
  }
}

function isError(outcome) {
  return outcome instanceof AbruptCompletionError;
}

class EmptyListError extends AbruptCompletionError {
  constructor() {
    super('empty-list-error', 'The empty list does not evaluate.');
  }
}

class MalformedForm extends AbruptCompletionError {
  constructor(formName) {
    super('malformed-form', `Malformed ${formName}.`);
  }
}

class ForEachNotImplemented extends AbruptCompletionError {
  constructor() {
    super('not-implemented', 'The _for-each form is not implemented.');
  }
}

class UnboundVariable extends AbruptCompletionError {
  constructor(variable, namespace) {
    super('unbound-variable', `The variable '${variable.name}' is unbound in the ${namespace} namespace.`);
  }
}

class TestFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The test form does not evaluate to a boolean.');
  }
}

class FunctionFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The function form does not evaluate to a function.');
  }
}

class ListFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The list form does not evaluate to a proper list.');
  }
}

class ExitTagFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The exit-tag form does not evaluate to a variable.');
  }
}

class HandlerFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The handler form does not evaluate to a function.');
  }
}

class OperatorFormTypeError extends AbruptCompletionError {
  constructor() {
    super('form-type-error', 'The operator form does not evaluate to a function.');
  }
}

const ordinalRules = new Intl.PluralRules('en-US', {type: 'ordinal'});
const ordinalSuffixes = new Map([['one', 'st'], ['two', 'nd'], ['few', 'rd'], ['other', 'th']]);

function ordinalNumber(n) {
  return n + ordinalSuffixes.get(ordinalRules.select(n));
}

class ArgumentTypeError extends AbruptCompletionError {
  constructor(n, constructor) {
    super('argument-type-error', `The ${ordinalNumber(n + 1)} argument is not of type ${constructor.name}.`);
  }
}

class LengthNotNonnegativeInteger extends AbruptCompletionError {
  constructor() {
    super('argument-value-error', 'The length is not an nonnegative integer.');
  }
}

class IndexNotNonnegativeInteger extends AbruptCompletionError {
  constructor() {
    super('argument-value-error', 'The index is not an nonnegative integer.');
  }
}

class IndexOutOfBounds extends AbruptCompletionError {
  constructor() {
    super('argument-value-error', 'The index is out of bounds.');
  }
}

class NoBlock extends AbruptCompletionError {
  constructor(blockName) {
    super('no-block', `No block named '${blockName}'.`);
  }
}

class NoBlockExitPoint extends AbruptCompletionError {
  constructor(blockName) {
    super('no-block-exit-point', `No exit point for block named '${blockName}'.`);
  }
}

class NoCatchExitPoint extends AbruptCompletionError {
  constructor(exitTag) {
    super('no-catch-exit-point', `No exit point with exit tag '${exitTag}'.`);
  }
}

class RunawayNonlocalExit extends AbruptCompletionError {
  constructor() {
    super('runaway-nonlocal-exit', 'Runaway nonlocal exit.');
  }
}

class TooFewArguments extends AbruptCompletionError {
  constructor() {
    super('too-few-arguments', 'Too few arguments.');
  }
}

class TooManyArguments extends AbruptCompletionError {
  constructor() {
    super('too-many-arguments', 'Too many arguments.');
  }
}

class SpreadError extends AbruptCompletionError {
  constructor() {
    super('spread-error', 'Malformed spreadable sequence of objects.');
  }
}

class ProgramError extends AbruptCompletionError {
  constructor(description) {
    super('program-error', description);
  }
}

/*******************************************/
/* Abrupt Completion of Type Nonlocal Exit */
/*******************************************/

class NonlocalExit extends AbruptCompletion {
  constructor(exitTag, values) {
    super();
    this.exitTag = exitTag;
    this.values = values;
  }
}

function isNonlocalExit(outcome) {
  return outcome instanceof NonlocalExit;
}

/**********/
/* Result */
/**********/

class Result extends Outcome { // abstract class
  constructor() {
    super();
  }
}

function isNormalCompletion(outcome) {
  return outcome instanceof Result;
}

/*******************/
/* Multiple Values */
/*******************/

class MultipleValues extends Result {
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

/******************************/
/* Primitive Data Type object */
/******************************/

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

/****************************/
/* Primitive Data Type void */
/****************************/

class EVLVoid extends EVLObject {
  constructor() {
    super();
  }
  toString() {
    return '#v';
  }
}

// the single object of type void
EVLVoid.VOID = new EVLVoid();

function nullToVoid(x) {
  return x === null ? EVLVoid.VOID : x;
}

primitiveFunction('void?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLVoid);
});

/*******************************/
/* Primitive Data Type boolean */
/*******************************/

class EVLBoolean extends EVLObject {
  constructor(jsValue) {
    super();
    this.jsValue = jsValue; // JavaScript boolean
  }
  toString() {
    return this.jsValue ? '#t' : '#f';
  }
}

// the single object of type boolean representing true
EVLBoolean.TRUE = new EVLBoolean(true);
// the single object of type boolean representing false
EVLBoolean.FALSE = new EVLBoolean(false);

function evlBoolean(jsBoolean) {
  return jsBoolean ? EVLBoolean.TRUE : EVLBoolean.FALSE;
}

primitiveFunction('boolean?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLBoolean);
});

/******************************/
/* Primitive Data Type number */
/******************************/

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
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return new EVLNumber(x.jsValue + y.jsValue);
});

primitiveFunction('_-', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return new EVLNumber(x.jsValue - y.jsValue);
});

primitiveFunction('_*', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return new EVLNumber(x.jsValue * y.jsValue);
});

primitiveFunction('_/', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return new EVLNumber(x.jsValue / y.jsValue);
});

primitiveFunction('%', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return new EVLNumber(x.jsValue % y.jsValue);
});

primitiveFunction('=', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue === y.jsValue);
});

primitiveFunction('/=', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue !== y.jsValue);
});

primitiveFunction('<', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue < y.jsValue);
});

primitiveFunction('<=', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue <= y.jsValue);
});

primitiveFunction('>', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue > y.jsValue);
});

primitiveFunction('>=', 2, 2, function(args) {
  const x = checkArgumentType(args, 0, EVLNumber);
  if (isError(x)) return x;
  const y = checkArgumentType(args, 1, EVLNumber);
  if (isError(y)) return y;
  return evlBoolean(x.jsValue >= y.jsValue);
});

/*********************************/
/* Primitive Data Type character */
/*********************************/

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

/******************************/
/* Primitive Data Type string */
/******************************/

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

function ensureEVLString(x) {
  return x instanceof EVLString ? x : new EVLString(x);
}

primitiveFunction('string?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLString);
});

/******************************/
/* Primitive Data Type symbol */
/******************************/

class EVLSymbol extends EVLObject { // abstract class
  constructor(name) {
    super();
    this.name = name; // JavaScript string
  }
}

primitiveFunction('symbol?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLSymbol);
});

/*******************************/
/* Primitive Data Type keyword */
/*******************************/

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
  const name = checkArgumentType(args, 0, EVLString);
  if (isError(name)) return name;
  return new EVLKeyword(name.jsValue);
});

/********************************/
/* Primitive Data Type variable */
/********************************/

class EVLVariable extends EVLSymbol {
  constructor(name) {
    super(name);
    this.value = null; // EVLObject or null
    this.function = null; // EVLObject or null
    this.plist = EVLEmptyList.NIL;
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

primitiveFunction('variable?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLVariable);
});

primitiveFunction('make-variable', 1, 1, function(args) {
  const name = checkArgumentType(args, 0, EVLString);
  if (isError(name)) return name;
  return new EVLVariable(name.jsValue);
});

primitiveFunction('variable-value', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return nullToVoid(variable.value);
});

primitiveFunction('variable-set-value!', 2, 2, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return variable.value = args[1];
});

primitiveFunction('variable-value-bound?', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return evlBoolean(variable.value !== null);
});

primitiveFunction('variable-unbind-value!', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return variable.value = null, EVLVoid.VOID;
});

primitiveFunction('variable-function', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return nullToVoid(variable.function);
});

primitiveFunction('variable-set-function!', 2, 2, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return variable.function = args[1];
});

primitiveFunction('variable-function-bound?', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return evlBoolean(variable.function !== null);
});

primitiveFunction('variable-unbind-function!', 1, 1, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  return variable.function = null, EVLVoid.VOID;
});

function plistGet(variable, key) {
  let cons = null;
  let plist = variable.plist;
  while (plist !== EVLEmptyList.NIL) {
    if (plist.car === key) {
      return [cons, plist];
    } else {
      cons = plist.cdr;
      plist = cons.cdr;
    }
  }
  return [cons, plist];
}

primitiveFunction('variable-plist-ref', 2, 2, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  const key = checkArgumentType(args, 1, EVLKeyword);
  if (isError(key)) return key;
  const [cons, plist] = plistGet(variable, key);
  if (plist !== EVLEmptyList.NIL) {
    return plist.cdr.car;
  } else {
    return EVLVoid.VOID;
  }
});

primitiveFunction('variable-plist-set!', 3, 3, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  const key = checkArgumentType(args, 1, EVLKeyword);
  if (isError(key)) return key;
  const value = args[2];
  const [cons, plist] = plistGet(variable, key);
  if (plist !== EVLEmptyList.NIL) {
    return plist.cdr.car = value;
  } else {
    if (cons !== null) {
      cons.cdr = new EVLCons(key, new EVLCons(value, EVLEmptyList.NIL));
    } else {
      variable.plist = new EVLCons(key, new EVLCons(value, EVLEmptyList.NIL));
    }
    return value;
  }
});

primitiveFunction('variable-plist-bound?', 2, 2, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  const key = checkArgumentType(args, 1, EVLKeyword);
  if (isError(key)) return key;
  const [cons, plist] = plistGet(variable, key);
  if (plist !== EVLEmptyList.NIL) {
    return EVLBoolean.TRUE;
  } else {
    return EVLBoolean.FALSE;
  }
});

primitiveFunction('variable-plist-unbind!', 2, 2, function(args) {
  const variable = checkArgumentType(args, 0, EVLVariable);
  if (isError(variable)) return variable;
  const key = checkArgumentType(args, 1, EVLKeyword);
  if (isError(key)) return key;
  const [cons, plist] = plistGet(variable, key);
  if (plist !== EVLEmptyList.NIL) {
    if (cons !== null) {
      cons.cdr = plist.cdr.cdr;
    } else {
      variable.plist = plist.cdr.cdr;
    }
    return EVLVoid.VOID;
  } else {
    return EVLVoid.VOID;
  }
});

/****************************/
/* Primitive Data Type list */
/****************************/

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

primitiveFunction('_make-list', 1, 2, function(args) {
  const number = checkArgumentType(args, 0, EVLNumber);
  if (isError(number)) return number;
  const length = number.jsValue;
  if (!Number.isInteger(length) || length < 0) {
    return new LengthNotNonnegativeInteger();
  }
  let list = EVLEmptyList.NIL;
  for (let n = 0; n < length; n++) {
    list = new EVLCons(EVLVoid.VOID, list);
  }
  return list;
});

/**********************************/
/* Primitive Data Type empty-list */
/**********************************/

class EVLEmptyList extends EVLList {
  constructor() {
    super();
  }
}

// the single object of type empty-list
EVLEmptyList.NIL = new EVLEmptyList();

primitiveFunction('empty-list?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLEmptyList);
});

/****************************/
/* Primitive Data Type cons */
/****************************/

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
  const cons = checkArgumentType(args, 0, EVLCons);
  if (isError(cons)) return cons;
  return cons.car;
});

primitiveFunction('set-car!', 2, 2, function(args) {
  const cons = checkArgumentType(args, 0, EVLCons);
  if (isError(cons)) return cons;
  return cons.car = args[1];
});

primitiveFunction('cdr', 1, 1, function(args) {
  const cons = checkArgumentType(args, 0, EVLCons);
  if (isError(cons)) return cons;
  return cons.cdr;
});

primitiveFunction('set-cdr!', 2, 2, function(args) {
  const cons = checkArgumentType(args, 0, EVLCons);
  if (isError(cons)) return cons;
  return cons.cdr = args[1];
});

/******************************/
/* Primitive Data Type vector */
/******************************/

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

primitiveFunction('make-vector', 1, 2, function(args) {
  const number = checkArgumentType(args, 0, EVLNumber);
  if (isError(number)) return number;
  const length = number.jsValue;
  if (!Number.isInteger(length) || length < 0) {
    return new LengthNotNonnegativeInteger();
  }
  return new EVLVector(new Array(length).fill(args.length === 1 ? null : args[1]));
});

primitiveFunction('vector-length', 1, 1, function(args) {
  const vector = checkArgumentType(args, 0, EVLVector);
  if (isError(vector)) return vector;
  return new EVLNumber(vector.elements.length);
});

function checkVectorIndex(elements, number) {
  const length = elements.length;
  const index = number.jsValue;
  if (!Number.isInteger(index) || index < 0) {
    return new IndexNotNonnegativeInteger();
  } else if (0 <= index && index < length) {
    return index;
  } else {
    return new IndexOutOfBounds();
  }
}

primitiveFunction('vector-ref', 2, 2, function(args) {
  const vector = checkArgumentType(args, 0, EVLVector);
  if (isError(vector)) return vector;
  const number = checkArgumentType(args, 1, EVLNumber);
  if (isError(number)) return number;
  const elements = vector.elements;
  const index = checkVectorIndex(elements, number);
  if (isError(index)) return index;
  return nullToVoid(elements[index]);
});

primitiveFunction('vector-set!', 3, 3, function(args) {
  const vector = checkArgumentType(args, 0, EVLVector);
  if (isError(vector)) return vector;
  const number = checkArgumentType(args, 1, EVLNumber);
  if (isError(number)) return number;
  const elements = vector.elements;
  const index = checkVectorIndex(elements, number);
  if (isError(index)) return index;
  return elements[index] = args[2];
});

primitiveFunction('vector-bound?', 2, 2, function(args) {
  const vector = checkArgumentType(args, 0, EVLVector);
  if (isError(vector)) return vector;
  const number = checkArgumentType(args, 1, EVLNumber);
  if (isError(number)) return number;
  const elements = vector.elements;
  const index = checkVectorIndex(elements, number);
  if (isError(index)) return index;
  return evlBoolean(elements[index] !== null);
});

primitiveFunction('vector-unbind!', 2, 2, function(args) {
  const vector = checkArgumentType(args, 0, EVLVector);
  if (isError(vector)) return vector;
  const number = checkArgumentType(args, 1, EVLNumber);
  if (isError(number)) return number;
  const elements = vector.elements;
  const index = checkVectorIndex(elements, number);
  if (isError(index)) return index;
  return elements[index] = null, EVLVoid.VOID;
});

/********************************/
/* Primitive Data Type function */
/********************************/

class EVLFunction extends EVLObject { // abstract class
  constructor() {
    super();
  }
}

primitiveFunction('function?', 1, 1, function(args) {
  return evlBoolean(args[0] instanceof EVLFunction);
});

/******************************************/
/* Primitive Data Type primitive-function */
/******************************************/

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

/*******************************/
/* Primitive Data Type closure */
/*******************************/

class EVLClosure extends EVLFunction {
  constructor(scope, namespace, macro, parameters, rest, serialForms, lenv) {
    super();
    this.scope = scope;
    this.namespace = namespace;
    this.macro = macro;
    this.parameters = parameters;
    this.rest = rest;
    this.serialForms = serialForms;
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
  return new MultipleValues(args);
});

primitiveFunction('error', 1, 1, function(args) {
  const description = checkArgumentType(args, 0, EVLString);
  if (isError(description)) return description;
  return new ProgramError(description);
});

primitiveFunction('now', 0, 0, function(args) {
  return new EVLNumber(Date.now());
});

/*************************************************/
/* Primitive Function Definitions (Second Steps) */
/*************************************************/

for (const [name, [arityMin, arityMax, jsFunction]] of primitiveFunctions) {
  GlobalEnv.set(FUN_NS, internVariable(name), new EVLPrimitiveFunction(arityMin, arityMax, jsFunction));
}

/***************************************/
/* Variables (Special Operators, etc.) */
/***************************************/

const notVariable = internVariable('not');
const andVariable = internVariable('and');
const orVariable = internVariable('or');
const quoteVariable = internVariable('quote');
const quasiquoteVariable = internVariable('quasiquote');
const unquoteVariable = internVariable('unquote');
const unquoteSplicingVariable = internVariable('unquote-splicing');
const prognVariable = internVariable('progn');
const ifVariable = internVariable('if');
const _forEachVariable = internVariable('_for-each');
const _vlambdaVariable = internVariable('_vlambda');
const _mlambdaVariable = internVariable('_mlambda');
const _flambdaVariable = internVariable('_flambda');
const _dlambdaVariable = internVariable('_dlambda');
const vrefVariable = internVariable('vref');
const vsetVariable = internVariable('vset!');
const frefVariable = internVariable('fref');
const fsetVariable = internVariable('fset!');
const drefVariable = internVariable('dref');
const dsetVariable = internVariable('dset!');
const blockVariable = internVariable('block');
const returnFromVariable = internVariable('return-from');
const catchVariable = internVariable('catch');
const throwVariable = internVariable('throw');
const _handlerBindVariable = internVariable('_handler-bind');
const unwindProtectVariable = internVariable('unwind-protect');
const mletVariable = internVariable('mlet');
const mlambdaVariable = internVariable('mlambda');
const applyVariable = internVariable('apply');
const multipleValueCallVariable = internVariable('multiple-value-call');
const multipleValueApplyVariable = internVariable('multiple-value-apply');

/****************************/
/* Interface (Command Line) */
/****************************/

const evaluatorOptions = [
  '--directstyle',
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
  console.log('--directstyle: selects the direct style evaluator');
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
