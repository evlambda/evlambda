// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import HTMLWebpackPlugin from 'html-webpack-plugin';
import ESLintWebpackPlugin from 'eslint-webpack-plugin';
import AdmZip from 'adm-zip';
import LicenseChecker from 'license-checker';
import url from 'url';
import path from 'path';
import fs from 'fs';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ArchiveSystemFilesWebpackPlugin {
  apply(compiler) {
    compiler.hooks.done.tap(
      'Archive System Files Webpack Plugin',
      (stats) => {
        if (['production'].includes(stats.compilation.options.mode)) {
          const zip = new AdmZip();
          for (const file of fs.readdirSync(path.join(__dirname, 'system-files'))) {
            zip.addFile(file, fs.readFileSync(path.join(__dirname, 'system-files', file)));
          }
          zip.writeZip(path.join(__dirname, 'ide', 'system-files.zip'));
        }
      }
    );
  }
}

class GenerateBOMWebpackPlugin {
  apply(compiler) {
    compiler.hooks.done.tap(
      'Generate BOM Webpack Plugin',
      (stats) => {
        if (['production'].includes(stats.compilation.options.mode)) {
          LicenseChecker.init(
            {start: '.'},
            (error, packages) => {
              if (error) {
                console.log('LicenseChecker error');
              } else {
                const pkgs = new Map();
                for (const [key, value] of Object.entries(packages)) {
                  // xxx@major.minor.patch => xxx
                  // @xxx/yyy@major.minor.patch => @xxx/yyy
                  pkgs.set(key.substring(0, key.lastIndexOf('@')), value);
                }
                const modules = new Set();
                for (const [pathname, module] of stats.compilation._modules.entries()) {
                  const match = pathname.match(/\/node_modules\/([^@][^\/]*)\//);
                  // .../node_modules/xxx/... => xxx
                  if (match !== null) {
                    modules.add(match[1]);
                  } else {
                    const match = pathname.match(/\/node_modules\/(@[^\/]+\/[^\/]+)\//);
                    // .../node_modules/@xxx/yyy/... => @xxx/yyy
                    if (match !== null) {
                      modules.add(match[1]);
                    }
                  }
                }
                const stream = fs.createWriteStream(path.join(__dirname, 'ide', 'bom.html'));
                stream.write('<!doctype html>');
                stream.write('<html>');
                stream.write('<head>');
                stream.write('<meta charset="utf-8">');
                stream.write('<title>E/V Lambda</title>');
                stream.write('<meta name="author" content="Raphaël Van Dyck">');
                stream.write('<link rel="icon" type="image/png" href="/images/favicon.png">');
                stream.write('<style>p.module {font-size: large; font-weight: bold;} p.property {margin: 0.5em 0;}</style>');
                stream.write('</head>');
                stream.write('<body>');
                stream.write('<p>Here is a list of the libraries used by the IDE.</p>');
                for (const module of Array.from(modules).sort()) {
                  const pkg = pkgs.get(module);
                  stream.write(`<p class="module">${htmlEscape(module)}</p>`);
                  writePackageProperty(stream, pkg, 'name');
                  writePackageProperty(stream, pkg, 'version');
                  writePackageProperty(stream, pkg, 'description');
                  writePackageProperty(stream, pkg, 'repository');
                  writePackageProperty(stream, pkg, 'publisher');
                  writePackageProperty(stream, pkg, 'email');
                  writePackageProperty(stream, pkg, 'url');
                  writePackageProperty(stream, pkg, 'licenses');
                  writeLicenseFile(stream, pkg);
                }
                stream.write('</body>');
                stream.write('</html>');
                stream.end();
              }
            }
          );
        }
      }
    );
  }
}

function writePackageProperty(stream, pkg, propertyName) {
  const propertyValue = pkg[propertyName];
  if (propertyValue !== undefined) {
    const escapedPropertyValue = htmlEscape(propertyValue);
    if (/^https?:\/\//.test(propertyValue)) {
      stream.write(`<p class="property">${propertyName}: <a href="${escapedPropertyValue}">${escapedPropertyValue}</a></p>`);
    } else {
      stream.write(`<p class="property">${propertyName}: ${escapedPropertyValue}</p>`);
    }
  }
}

function writeLicenseFile(stream, pkg) {
  const licenseFile = pkg.licenseFile;
  if (licenseFile !== undefined) {
    const basename = path.basename(licenseFile, path.extname(licenseFile)).toUpperCase();
    if (basename !== 'README' && fs.existsSync(licenseFile)) {
      stream.write('<pre>');
      stream.write(htmlEscape(fs.readFileSync(licenseFile, {encoding: 'utf8'})));
      stream.write('</pre>');
    }
  }
}

function htmlEscape(string) {
  return string.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
    }
  });
}

export default {
  entry: './src/ide.jsx',
  output: {
    path: path.join(__dirname, 'ide'),
    filename: 'bundle.js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: ['babel-loader']
      },
      {
        test: /\.scss$/,
        exclude: /node_modules/,
        use: ['style-loader', 'css-loader', 'sass-loader']
      }
    ]
  },
  plugins: [
    new HTMLWebpackPlugin({
      template: './src/ide.html',
      filename: 'ide.html'
    }),
    new ESLintWebpackPlugin({
      extensions: ['js', 'jsx']
    }),
    new ArchiveSystemFilesWebpackPlugin(),
    new GenerateBOMWebpackPlugin()
  ],
  mode: 'development'
};
