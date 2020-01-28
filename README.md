### WebExtensions JSDOM

When testing [WebExtensions](https://developer.mozilla.org/Add-ons/WebExtensions) you might want to test your browser_action default_popup, sidebar_action default_panel or background page/scripts inside [JSDOM](https://github.com/jsdom/jsdom). This package lets you do that based on the `manifest.json`. It will automatically stub `window.browser` with [`webextensions-api-mock`](https://github.com/stoically/webextensions-api-mock).

### Installation

```
npm install --save-dev webextensions-jsdom sinon
```

**Important**: `sinon` is a peer dependency, so you have to install it yourself. That's because it can otherwise lead to unexpected assertion behavior when sinon does `instanceof` checks internally. It also allows to upgrade sinon without the need to bump the version in `webextensions-api-mock`.

### Usage

```js
const webExtensionsJSDOM = require("webextensions-jsdom");
const webExtension = await webExtensionsJSDOM.fromManifest(
  "/absolute/path/to/manifest.json"
);
```

Based on what's given in your `manifest.json` this will create JSDOM instances with stubbed `browser` and load popup/sidebar/background in it.

The resolved return value is an `<object>` with several properties:

- _background_ `<object>`, with properties `dom`, `window`, `document`, `browser` and `destroy` (If background page or scripts are defined in the manifest)
- _popup_ `<object>`, with properties `dom`, `window`, `document`, `browser` and `destroy` (If browser_action with default_popup is defined in the manifest)
- _sidebar_ `<object>`, with properties `dom`, `window`, `document`, `browser` and `destroy` (If sidebar_action with default_panel is defined in the manifest)
- _destroy_ `<function>`, shortcut to `background.destroy`, `popup.destroy` and `sidebar.destroy`

`dom` is a new JSDOM instance. `window` is a shortcut to `dom.window`. `document` is a shortcut to `dom.window.document`. `browser` is a new `webextensions-api-mock` instance that is also exposed on `dom.window.browser`. And `destroy` is a function to clean up. More infos in the [API docs](#api).

If you expose variables in your code on `window`, you can access them now, or trigger registered listeners by e.g. `browser.webRequest.onBeforeRequest.addListener.yield([arguments])`.

### Automatic wiring

If popup/sidebar _and_ background are defined and loaded then `runtime.sendMessage` in the popup is automatically wired with `runtime.onMessage` in the background if you pass the `wiring: true` option. That makes it possible to e.g. "click" elements in the popup and then check if the background was called accordingly, making it ideal for feature-testing.

```js
await webExtensionsJSDOM.fromManifest("/absolute/path/to/manifest.json", {
  wiring: true
});
```

### API Fake

Passing `apiFake: true` in the options to `fromManifest` automatically applies [`webextensions-api-fake`](https://github.com/stoically/webextensions-api-fake) to the `browser` stubs. It will imitate some of the WebExtensions API behavior (like an in-memory `storage`), so you don't have to manually define behavior. This is especially useful when feature-testing.

```js
await webExtensionsJSDOM.fromManifest("/absolute/path/to/manifest.json", {
  apiFake: true
});
```

### Code Coverage

Code coverage with [nyc / istanbul](https://istanbul.js.org/) is supported if you execute the test using `webextensions-jsdom` with `nyc`. To get coverage-output you need to call the exposed `destroy` function after the `background`, `popup` and/or `sidebar` are no longer needed. This should ideally be after each test.

If you want to know how that's possible you can [check out this excellent article by @freaktechnik](https://humanoids.be/log/2017/10/code-coverage-reports-for-webextensions/).

### Chrome Extensions

Not supported, but you could use [webextension-polyfill](https://github.com/mozilla/webextension-polyfill).

### Example

In your `manifest.json` you have default_popup and background page defined:

```json
{
  "browser_action": {
    "default_popup": "popup.html"
  },

  "background": {
    "page": "background.html"
  }
}
```

_Note: "scripts" are supported too._

In your `popup.js` loaded from `popup.html` you have something like this:

```js
document.getElementById("doSomethingUseful").addEventListener("click", () => {
  browser.runtime.sendMessage({
    method: "usefulMessage"
  });
});
```

and in your `background.js` loaded from the `background.html`

```js
browser.runtime.onMessage.addListener(message => {
  // do something useful with the message
});
```

To test this with `webextensions-jsdom` you can do (using `mocha`, `chai` and `sinon-chai` in this case):

```js
const path = require("path");
const sinonChai = require("sinon-chai");
const chai = require("chai");
const expect = chai.expect;
chai.use(sinonChai);

const webExtensionsJSDOM = require("webextensions-jsdom");
const manifestPath = path.resolve(
  path.join(__dirname, "path/to/manifest.json")
);

describe("Example", () => {
  let webExtension;
  beforeEach(async () => {
    webExtension = await webExtensionsJSDOM.fromManifest(manifestPath, {
      wiring: true
    });
  });

  describe("Clicking in the popup", () => {
    beforeEach(async () => {
      await webExtension.popup.document
        .getElementById("doSomethingUseful")
        .click();
    });

    it("should call the background", async () => {
      expect(
        webExtension.background.browser.onMessage.addListener
      ).to.have.been.calledWithMatch({
        method: "usefulMessage"
      });
    });
  });

  afterEach(async () => {
    await webExtension.destroy();
  });
});
```

There's a fully functional example in [`examples/random-container-tab`](examples/random-container-tab).

### API

#### Exported function fromManifest(path[, options])

- _path_ `<string>`, required, absolute path to the `manifest.json` file
- _options_ `<object>`, optional
  - _background_ `<object|false>` optional, if `false` is given background wont be loaded
    - _jsdom_ `<object>`, optional, this will set all given properties as [options for the JSDOM constructor](https://github.com/jsdom/jsdom#customizing-jsdom), an useful example might be [`beforeParse(window)`](https://github.com/jsdom/jsdom#intervening-before-parsing). Note: You can't set `resources` or `runScripts`.
    - _afterBuild(background)_ `<function>` optional, executed directly after the background dom is build (might be useful to do things before the popup dom starts building). If a Promise is returned it will be resolved before continuing.
  - _popup_ `<object|false>` optional, if `false` is given popup wont be loaded
    - _jsdom_ `<object>`, optional, this will set all given properties as [options for the JSDOM constructor](https://github.com/jsdom/jsdom#customizing-jsdom), an useful example might be [`beforeParse(window)`](https://github.com/jsdom/jsdom#intervening-before-parsing). Note: You can't set `resources` or `runScripts`.
    - _afterBuild(popup)_ `<function>` optional, executed after the popup dom is build. If a Promise is returned it will be resolved before continuing.
  - _sidebar_ `<object|false>` optional, if `false` is given sidebar wont be loaded
    - _jsdom_ `<object>`, optional, this will set all given properties as [options for the JSDOM constructor](https://github.com/jsdom/jsdom#customizing-jsdom), an useful example might be [`beforeParse(window)`](https://github.com/jsdom/jsdom#intervening-before-parsing). Note: You can't set `resources` or `runScripts`.
    - _afterBuild(sidebar)_ `<function>` optional, executed after the sidebar dom is build. If a Promise is returned it will be resolved before continuing.
  - _autoload_ `<boolean>` optional, if `false` will not automatically load background/popup/sidebar (might be useful for `loadURL`)
  - _apiFake_ `<boolean>` optional, if `true` automatically applies [API fakes](#api-fake) to the `browser` using [`webextensions-api-fake`](https://github.com/stoically/webextensions-api-fake) and if `path/_locales` is present its content will get passed down to api-fake.
  - _wiring_ `<boolean>` optional, if `true` the [automatic wiring](#automatic-wiring) is enabled

Returns a Promise that resolves an `<object>` with the following properties in case of success:

- _background_ `<object>`

  - _dom_ `<object>` the JSDOM object
  - _window_ `<object>` shortcut to `dom.window`
  - _document_ `<object>` shortcut to `dom.window.document`
  - _browser_ `<object>` stubbed `browser` using `webextensions-api-mock`
  - _destroy_ `<function>` destroy the `dom` and potentially write coverage data if executed with `nyc`. Returns a Promise that resolves if destroying is done.

- _popup_ `<object>`

  - _dom_ `<object>` the JSDOM object
  - _window_ `<object>` shortcut to `dom.window`
  - _document_ `<object>` shortcut to `dom.window.document`
  - _browser_ `<object>` stubbed `browser` using `webextensions-api-mock`
  - _destroy_ `<function>` destroy the `dom` and potentially write coverage data if executed with `nyc`. Returns a Promise that resolves if destroying is done.
  - _helper_ `<object>`
    - _clickElementById(id)_ `<function>` shortcut for `dom.window.document.getElementById(id).click();`, returns a promise

- _sidebar_ `<object>`

  - _dom_ `<object>` the JSDOM object
  - _window_ `<object>` shortcut to `dom.window`
  - _document_ `<object>` shortcut to `dom.window.document`
  - _browser_ `<object>` stubbed `browser` using `webextensions-api-mock`
  - _destroy_ `<function>` destroy the `dom` and potentially write coverage data if executed with `nyc`. Returns a Promise that resolves if destroying is done.
  - _helper_ `<object>`
    - _clickElementById(id)_ `<function>` shortcut for `dom.window.document.getElementById(id).click();`, returns a promise

- _destroy_ `<function>`, shortcut to call `background.destroy`,`popup.destroy` and `sidebar.destroy`. Returns a Promise that resolves if destroying is done.

#### Exported function fromFile(path[, options])

Load an arbitrary `.html` file, accepts the following parameters:

- _path_ `<string>`, required, absolute path to the html file that should be loaded
- _options_ `<object>`, optional, accepts the following parameters
  - _apiFake_ `<boolean>` optional, if `true` automatically applies [API fakes](#api-fake) to the `browser` using [`webextensions-api-fake`](https://github.com/stoically/webextensions-api-fake)
  - _jsdom_ `<object>`, optional, this will set all given properties as [options for the JSDOM constructor](https://github.com/jsdom/jsdom#customizing-jsdom), an useful example might be [`beforeParse(window)`](https://github.com/jsdom/jsdom#intervening-before-parsing). Note: You can't set `resources` or `runScripts`.

Returns a Promise that resolves an `<object>` with the following properties in case of success:

- _dom_ `<object>` the JSDOM object
- _window_ `<object>` shortcut to `dom.window`
- _document_ `<object>` shortcut to `dom.window.document`
- _browser_ `<object>` stubbed `browser` using `webextensions-api-mock`
- _destroy_ `<function>` destroy the `dom` and potentially write coverage data if executed with `nyc`. Returns a Promise that resolves if destroying is done.

### GeckoDriver

If you're looking for a way to do functional testing with GeckoDriver then [`webextensions-geckodriver`](https://github.com/webexts/webextensions-geckodriver) might be for you.

### Sinon useFakeTimers

```js
sinon.useFakeTimers({
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]
});
```

- https://stackoverflow.com/a/50152624
