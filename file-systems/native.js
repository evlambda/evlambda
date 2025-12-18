// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import path from 'path';
import fs from 'fs';

function pathnameToNativePathname(root, pathname) {
  // pathname: [''], ['', <name>], ['', <name>, <name>], ...
  // <name> !== ''
  // <name> !== '.'
  // <name> !== '..'
  return path.join(root, ...pathname);
}

function checkIsDirectory(nativePathname) {
  const stat = fs.statSync(nativePathname, {throwIfNoEntry: false});
  if (stat === undefined) {
    throw new Error('The file does not exist.');
  }
  if (!stat.isDirectory()) {
    throw new Error('The file is not a directory.');
  }
}

function checkIsNotDirectory(nativePathname) {
  const stat = fs.statSync(nativePathname, {throwIfNoEntry: false});
  if (stat === undefined) {
    throw new Error('The file does not exist.');
  }
  if (stat.isDirectory()) {
    throw new Error('The file is a directory.');
  }
}

export function getCapabilities(options) {
  return {writable: options.writable};
}

export function getFileContents(pathname, options) {
  const nativePathname = pathnameToNativePathname(options.root, pathname);
  checkIsNotDirectory(nativePathname);
  return fs.readFileSync(nativePathname);
}

export function putFileContents(pathname, contents, options) {
  if (!options.writable) {
    throw new Error('The file system is not writable.');
  }
  const nativePathname = pathnameToNativePathname(options.root, pathname);
  checkIsNotDirectory(nativePathname);
  fs.writeFileSync(nativePathname, contents);
}
