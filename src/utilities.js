// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

export function copyInstance(instance, properties = {}) {
  return Object.assign(Object.create(Object.getPrototypeOf(instance)), instance, properties);
}

export function copyMap(map, key, value) {
  const newMap = new Map(map);
  newMap.set(key, value);
  return newMap;
}

export function htmlEscape(string) {
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
