// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import dotenv from 'dotenv';
dotenv.config({path: '.env'});
dotenv.config({path: '.env.local', override: true});
const EVLAMBDA_PORT = process.env.EVLAMBDA_PORT;
console.log(`EVLAMBDA_PORT: ${EVLAMBDA_PORT}`);

import express from 'express';
import url from 'url';
import path from 'path';
import fileSystemRouter from './file-systems/router.js'
import * as nativeFileSystem from './file-systems/native.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number.parseInt(EVLAMBDA_PORT);

app.use('/ide', express.static(path.join(__dirname, 'ide'), {
  setHeaders: (res) => {
    res.set({
      // security requirements to use SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    });
  }
}));

app.use('/fs/system', fileSystemRouter(nativeFileSystem, {root: path.join(__dirname, 'system-files'), writable: true}));

app.listen(port, () => {
  console.log(`IDE url: http://localhost:${port}/ide/ide.html`);
});
