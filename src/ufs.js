// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

export function unifiedPathnameFileSystemName(unifiedPathname) {
  // /<file-system-name>/<dir>/.../<dir>/<name> => <file-system-name>
  const index = unifiedPathname.indexOf('/', 1);
  return unifiedPathname.substring(1, index);
}

export function unifiedPathnamePathname(unifiedPathname) {
  // /<file-system-name>/<dir>/.../<dir>/<name> => /<dir>/.../<dir>/<name>
  const index = unifiedPathname.indexOf('/', 1);
  return unifiedPathname.substring(index);
}

class NetworkError extends Error {} // fetch error
class ClientError extends Error {} // status = 400

function isClientError (response) {
  return response.status === 400;
}

const NULL_RESPONSE = 0;
const TEXT_RESPONSE = 1;
const JSON_RESPONSE = 2;
const BLOB_RESPONSE = 3;

function handleUFSResponse(response, kind) {
  switch (response.status) {
    case 200:
      switch (kind) {
        case NULL_RESPONSE:
          return null; // the body is empty or ignored
        case TEXT_RESPONSE:
          return response.text();
        case JSON_RESPONSE:
          return response.json();
        case BLOB_RESPONSE:
          return response.blob();
        default:
          throw new Error();
      }
    case 400:
      return response.text(); // the body contains a plain text error message suitable to show to the user
    default:
      throw new Error(response.statusText);
  }
}

function handleUFSError(error, onError) {
  if (error instanceof NetworkError) {
    onError('The server is unreachable.');
  } else if (error instanceof ClientError) {
    onError(error.message);
  } else {
    onError('Internal server error.');
  }
}

export function getFileSystemCapabilities(unifiedPathname, onSuccess, onFailure) {
  let clientError = false;
  const fileSystemName = unifiedPathnameFileSystemName(unifiedPathname);
  const url = new URL('/fs/' + fileSystemName + '/get-capabilities', window.location.href);
  fetch(url, {
    method: 'GET'
  }).catch(() => {
    throw new NetworkError();
  }).then(response => {
    clientError = isClientError(response);
    return handleUFSResponse(response, JSON_RESPONSE);
  }).then(data => {
    if (clientError) {
      throw new ClientError(data);
    } else {
      // data = {writable: <boolean>}
      onSuccess(data);
    }
  }).catch(error => {
    handleUFSError(error, onFailure);
  });
}

export function getFileContents(unifiedPathname, onSuccess, onFailure) {
  let clientError = false;
  const fileSystemName = unifiedPathnameFileSystemName(unifiedPathname);
  const url = new URL('/fs/' + fileSystemName + '/get-file-contents', window.location.href);
  url.searchParams.set('pathname', unifiedPathnamePathname(unifiedPathname));
  fetch(url, {
    method: 'GET'
  }).catch(() => {
    throw new NetworkError();
  }).then(response => {
    clientError = isClientError(response);
    return handleUFSResponse(response, TEXT_RESPONSE);
  }).then(data => {
    if (clientError) {
      throw new ClientError(data);
    } else {
      // data = <string>
      onSuccess(data);
    }
  }).catch(error => {
    handleUFSError(error, onFailure);
  });
}

export function putFileContents(unifiedPathname, contents, onSuccess, onFailure) {
  let clientError = false;
  const fileSystemName = unifiedPathnameFileSystemName(unifiedPathname);
  const url = new URL('/fs/' + fileSystemName + '/put-file-contents', window.location.href);
  url.searchParams.set('pathname', unifiedPathnamePathname(unifiedPathname));
  fetch(url, {
    method: 'PUT',
    headers: {'Content-Type': 'application/octet-stream'},
    body: contents
  }).catch(() => {
    throw new NetworkError();
  }).then(response => {
    clientError = isClientError(response);
    return handleUFSResponse(response, NULL_RESPONSE);
  }).then(data => {
    if (clientError) {
      throw new ClientError(data);
    } else {
      // data = <null>
      onSuccess();
    }
  }).catch(error => {
    handleUFSError(error, onFailure);
  });
}
