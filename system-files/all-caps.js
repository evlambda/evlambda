// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

window.addEventListener('focus', event => {
  window.parent.dispatchEvent(new CustomEvent('iframeFocus', {detail: windowId}));
});

window.addEventListener('keydown', event => {
  if (event.ctrlKey && (event.altKey || event.metaKey)) {
    window.parent.dispatchEvent(new CustomEvent('iframeKeyDown', {detail: event}));
    event.preventDefault();
  }
});
