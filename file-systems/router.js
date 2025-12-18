// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import express from 'express';

class ClientError extends Error {}

function isString(value) {
  return typeof value === 'string';
}

function invalidStringParameter() {
  throw new Error('Invalid string parameter.');
}

function validateStringParameter(value) {
  if (!isString(value)) {
    invalidStringParameter();
  }
  return value;
}

function invalidNonNegativeIntegerParameter() {
  throw new Error('Invalid non-negative integer parameter.');
}

function validateNonNegativeIntegerParameter(value) {
  if (!isString(value) || !/^(0|[1-9][0-9]*)$/.test(value)) {
    invalidNonNegativeIntegerParameter();
  }
  return Number.parseInt(value);
}

function invalidBooleanParameter() {
  throw new Error('Invalid boolean parameter.');
}

function validateBooleanParameter(value) {
  if (!isString(value)) {
    invalidBooleanParameter();
  }
  switch (value) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      invalidBooleanParameter();
  }
}

function isValidName(name) {
  return !name.includes('\x00') &&
         !name.includes('/') &&
         name !== '' &&
         name !== '.' &&
         name !== '..';
}

function invalidNameParameter() {
  throw new Error('Invalid name parameter.');
}

function validateNameParameter(name) {
  if (!isString(name) || !isValidName(name)) {
    invalidNameParameter();
  }
  return name;
}

function invalidNamesParameter() {
  throw new Error('Invalid names parameter.');
}

function validateNamesParameter(names) {
  if (!Array.isArray(names)) {
    invalidNamesParameter();
  }
  if (names.length === 0) {
    invalidNamesParameter();
  }
  for (const name of names) {
    if (!isString(name) || !isValidName(name)) {
      invalidNamesParameter();
    }
  }
  if (new Set(names).size !== names.length) {
    invalidNamesParameter();
  }
  names.sort();
  return names;
}

function invalidPathnameParameter() {
  throw new Error('Invalid pathname parameter.');
}

function validatePathnameParameter(pathname) {
  if (!isString(pathname)) {
    invalidPathnameParameter();
  }
  const names = pathname.split('/');
  if (names[0] !== '') {
    invalidPathnameParameter();
  }
  for (let i = 1; i < names.length; i++) {
    if (!isValidName(names[i])) {
      invalidPathnameParameter();
    }
  }
  return names;
}

function makeRouter(fileSystem, options) {
  options.ClientError = ClientError;
  const router = express.Router();
  router.get('/get-capabilities', (req, res) => {
    res.json(fileSystem.getCapabilities(options));
  });
  router.get('/get-file-contents', (req, res) => {
    res.send(fileSystem.getFileContents(validatePathnameParameter(req.query.pathname), options));
  });
  router.put('/put-file-contents', express.raw({limit: '200kb'}), (req, res) => {
    fileSystem.putFileContents(validatePathnameParameter(req.query.pathname), req.body, options);
    res.end();
  });
  router.use((err, req, res, next) => {
    console.log(err.message);
    if (err instanceof ClientError) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Internal Server Error');
    }
  });
  return router;
}

export default makeRouter;
