// SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

/******************/
/* Event Handlers */
/******************/

window.addEventListener('focus', event => {
  window.parent.dispatchEvent(new CustomEvent('iframeFocus', {detail: windowId}));
});

window.addEventListener('keydown', event => {
  if (event.ctrlKey && (event.altKey || event.metaKey)) {
    window.parent.dispatchEvent(new CustomEvent('iframeKeyDown', {detail: event}));
    event.preventDefault();
  }
});

/***********/
/* MathJax */
/***********/

const origin = document.location.origin;

window.MathJax = {
  options: {
    skipHtmlTags: {'[-]': ['code']}
  },
  loader: {
    load: ['[tex]/texhtml', '[tex]/mathtools']
  },
  tex: {
    packages: {'[+]': ['texhtml', 'mathtools']},
    allowTexHTML: true,
    inlineMath: {'[+]': [['$', '$']]},
    macros: {
      code: ['<tex-html><code>#1</code></tex-html>', 1],
      mlvar: ['\\textit{#1}', 1],
      metavar: ['\\langle\\textrm{#1}\\rangle', 1],
      metavarn: ['\\langle\\textrm{#1}_{#2}\\rangle', 2],
      form: '\\mlvar{form}',
      var: '\\mlvar{var}',
      arg: '\\mlvar{arg}',
      obj: '\\mlvar{obj}',
      fun: '\\mlvar{fun}',
      env: '\\mlvar{env}',
      lexenv: '\\mlvar{lexenv}',
      dynenv: '\\mlvar{dynenv}',
      ns: '\\mlvar{ns}',
      binding: '\\mlvar{binding}',
      vbind: '\\rightarrow_\\textrm{v}',
      vbinding: ['\\code{#1}\\vbind\\code{#2}', 2],
      fbind: '\\rightarrow_\\textrm{f}',
      fbinding: ['\\code{#1}\\fbind\\code{#2}', 2],
      primval: '\\mlvar{primval}',
      type: '\\mlvar{type}',
      object: '\\mlvar{object}',
      void: '\\mlvar{void}',
      boolean: '\\mlvar{boolean}',
      number: '\\mlvar{number}',
      character: '\\mlvar{character}',
      string: '\\mlvar{string}',
      symbol: '\\mlvar{symbol}',
      keyword: '\\mlvar{keyword}',
      variable: '\\mlvar{variable}',
      list: '\\mlvar{list}',
      emptylist: '\\mlvar{empty-list}',
      cons: '\\mlvar{cons}',
      vector: '\\mlvar{vector}',
      function: '\\mlvar{function}',
      primitivefunction: '\\mlvar{primitive-function}',
      closure: '\\mlvar{closure}',
      hex: '\\mlvar{hex}'
    }
  },
  output: {
    //font: 'mathjax-newcm',
    font: 'mathjax-stix2',
    fontPath: origin + '/ide/%%FONT%%-font',
    displayAlign: 'left',
    displayIndent: '2em',
    displayOverflow: 'linebreak',
    linebreaks: {
      inline: true
    }
  }
};

(function () {
  var script = document.createElement('script');
  script.src = origin + '/ide/mathjax/tex-chtml-nofont.js';
  script.defer = true;
  document.head.appendChild(script);
})();
