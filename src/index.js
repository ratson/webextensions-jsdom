const fs = require('fs');
const path = require('path');
const jsdom = require('jsdom');
const {WebExtensionsApiFake} = require('webextensions-api-fake');
const nyc = require('./nyc');

class WebExtensionsJSDOM {
  constructor() {
    this.webExtensionsApiFake = new WebExtensionsApiFake;
    this.webExtension = {};

    this.nyc = new nyc;
  }

  nextTick() {
    return new Promise(resolve => {
      setTimeout(() => {
        process.nextTick(resolve);
      });
    });
  }

  async buildDom(options = {}, html = false, scripts = false) {
    const virtualConsole = new jsdom.VirtualConsole;
    virtualConsole.sendTo(console);
    virtualConsole.on('jsdomError', (error) => {
      // eslint-disable-next-line no-console
      console.error(error.stack, error.detail);
    });

    const jsdomOptions = Object.assign({
      runScripts: 'outside-only',
      resources: 'usable',
      virtualConsole
    }, options);

    let dom;
    let scriptSrcs = '';
    if (!html) {
      dom = await jsdom.JSDOM.fromFile(options.path, jsdomOptions);
      const scripts = dom.window.document.getElementsByTagName('script');
      for (const script of [...scripts]) {
        const scriptSrc = script.src.replace(/^file:\/\//, '');
        scriptSrcs += await this.nyc.instrument(scriptSrc, 'utf-8');
        // eslint-disable-next-line quotes
        scriptSrcs += ";\n;";
      }
    } else {
      dom = new jsdom.JSDOM(html, jsdomOptions);
      for (const script of scripts) {
        const scriptSrc = script.replace(/^file:\/\//, '');
        scriptSrcs += await this.nyc.instrument(scriptSrc, 'utf-8');
        // eslint-disable-next-line quotes
        scriptSrcs += ";\n;";
      }
    }
    dom.window.eval(scriptSrcs);
    await this.nextTick();

    return dom;
  }

  async buildBackground(background, manifestPath, options = {}) {
    const browser = this.webExtensionsApiFake.createBrowser();
    const that = this;
    browser.contextMenus = browser.menus;

    const buildDomOptions = {
      beforeParse(window) {
        window.browser = browser;
        if (options.apiFake) {
          that.webExtensionsApiFake.fakeApi(window.browser);
        }

        if (options && options.beforeParse) {
          options.beforeParse(window);
        }
      }
    };

    let dom;
    if (background.page) {
      const backgroundPath = path.resolve(manifestPath, background.page);
      buildDomOptions.path = backgroundPath;
      dom = await this.buildDom(buildDomOptions);
    } else if (background.scripts) {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const scripts = [];
      for (const script of background.scripts) {
        scripts.push(path.resolve(path.join(manifestPath, script)));
      }
      dom = await this.buildDom(buildDomOptions, html, scripts);
    }

    this.webExtension.background = {
      browser,
      dom,
      document: dom.window.document,
      writeCoverage: () => {
        this.nyc.writeCoverage(dom.window);
      }
    };
    if (options && options.afterBuild) {
      await options.afterBuild(this.webExtension.background);
    }
    return this.webExtension.background;
  }

  async buildPopup(popupPath, options = {}) {
    const browser = this.webExtensionsApiFake.createBrowser();
    const that = this;
    browser.contextMenus = browser.menus;
    const dom = await this.buildDom({
      path: popupPath,
      beforeParse(window) {
        window.browser = browser;
        if (options.apiFake) {
          that.webExtensionsApiFake.fakeApi(window.browser);
        }

        if (that.webExtension.background) {
          window.browser.runtime.sendMessage.callsFake(function() {
            const [result] = that.webExtension.background.browser.runtime.onMessage.addListener.yield(...arguments);
            return result;
          });
        }

        if (options && options.beforeParse) {
          options.beforeParse(window);
        }
      }
    });
    const helper = {
      async clickElementById(id) {
        dom.window.document.getElementById(id).click();
        await this.nextTick();
      }
    };
    this.webExtension.popup = {
      browser,
      dom,
      document: dom.window.document,
      helper,
      writeCoverage: () => {
        this.nyc.writeCoverage(dom.window);
      }
    };
    if (options && options.afterBuild) {
      await options.afterBuild(this.webExtension.popup);
    }
    return this.webExtension.popup;
  }
}

const fromManifest = async (manifestPath, options = {}) => {
  const webExtensionJSDOM = new WebExtensionsJSDOM;
  const manifestFilePath = path.resolve(manifestPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFilePath));

  const webExtension = {};
  if ((typeof options.background === 'undefined' || options.background) &&
      manifest.background &&
      (manifest.background.page || manifest.background.scripts)) {
    if (typeof options.background !== 'object') {
      options.background = {};
    }
    if (typeof options.apiFake !== 'undefined') {
      options.background.apiFake = options.apiFake;
    }
    webExtension.background = await webExtensionJSDOM.buildBackground(manifest.background, manifestPath, options.background);
  }

  if ((typeof options.popup === 'undefined' || options.popup) &&
      manifest.browser_action && manifest.browser_action.default_popup) {
    const popupPath = path.resolve(manifestPath, manifest.browser_action.default_popup);
    if (typeof options.popup !== 'object') {
      options.popup = {};
    }
    if (typeof options.apiFake !== 'undefined') {
      options.popup.apiFake = options.apiFake;
    }
    webExtension.popup = await webExtensionJSDOM.buildPopup(popupPath, options.popup);
  }

  return webExtension;
};

module.exports = {
  fromManifest,
  WebExtensionsJSDOM
};