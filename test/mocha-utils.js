/**
 * Copyright 2020 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { TestServer } = require('../utils/testserver/index');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sinon = require('sinon');
const puppeteer = require('../');
const utils = require('./utils');
const rimraf = require('rimraf');

const { trackCoverage } = require('./coverage-utils');

const setupServer = async () => {
  const assetsPath = path.join(__dirname, 'assets');
  const cachedPath = path.join(__dirname, 'assets', 'cached');

  const port = 8907;
  const server = await TestServer.create(assetsPath, port);
  server.enableHTTPCache(cachedPath);
  server.PORT = port;
  server.PREFIX = `http://localhost:${port}`;
  server.CROSS_PROCESS_PREFIX = `http://127.0.0.1:${port}`;
  server.EMPTY_PAGE = `http://localhost:${port}/empty.html`;

  const httpsPort = port + 1;
  const httpsServer = await TestServer.createHTTPS(assetsPath, httpsPort);
  httpsServer.enableHTTPCache(cachedPath);
  httpsServer.PORT = httpsPort;
  httpsServer.PREFIX = `https://localhost:${httpsPort}`;
  httpsServer.CROSS_PROCESS_PREFIX = `https://127.0.0.1:${httpsPort}`;
  httpsServer.EMPTY_PAGE = `https://localhost:${httpsPort}/empty.html`;

  return { server, httpsServer };
};

exports.getTestState = () => state;

const product =
  process.env.PRODUCT || process.env.PUPPETEER_PRODUCT || 'Chromium';

const alternativeInstall = process.env.PUPPETEER_ALT_INSTALL || false;

const isHeadless =
  (process.env.HEADLESS || 'true').trim().toLowerCase() === 'true';
const isFirefox = product === 'firefox';
const isChrome = product === 'Chromium';

let extraLaunchOptions = {};
try {
  extraLaunchOptions = JSON.parse(process.env.EXTRA_LAUNCH_OPTIONS || '{}');
} catch (error) {
  console.warn(
    `Error parsing EXTRA_LAUNCH_OPTIONS: ${error.message}. Skipping.`
  );
}

const defaultBrowserOptions = Object.assign(
  {
    handleSIGINT: false,
    executablePath: process.env.BINARY,
    slowMo: false,
    headless: isHeadless,
    dumpio: !!process.env.DUMPIO,
  },
  extraLaunchOptions
);

(async () => {
  if (defaultBrowserOptions.executablePath) {
    console.warn(
      `WARN: running ${product} tests with ${defaultBrowserOptions.executablePath}`
    );
  } else {
    if (product === 'firefox') await puppeteer._launcher._updateRevision();
    const executablePath = puppeteer.executablePath();
    if (!fs.existsSync(executablePath))
      throw new Error(
        `Browser is not downloaded at ${executablePath}. Run 'npm install' and try to re-run tests`
      );
  }
})();

const setupGoldenAssertions = () => {
  const suffix = product.toLowerCase();
  const GOLDEN_DIR = path.join(__dirname, 'golden-' + suffix);
  const OUTPUT_DIR = path.join(__dirname, 'output-' + suffix);
  if (fs.existsSync(OUTPUT_DIR)) rimraf.sync(OUTPUT_DIR);
  utils.extendExpectWithToBeGolden(GOLDEN_DIR, OUTPUT_DIR);
};

setupGoldenAssertions();

const state = {};

global.itFailsFirefox = (...args) => {
  if (isFirefox) return xit(...args);
  else return it(...args);
};

global.itChromeOnly = (...args) => {
  if (isChrome) return it(...args);
  else return xit(...args);
};

global.itOnlyRegularInstall = (...args) => {
  if (alternativeInstall || process.env.BINARY) return xit(...args);
  else return it(...args);
};

global.itFailsWindowsUntilDate = (date, ...args) => {
  if (os.platform() === 'win32' && Date.now() < date) {
    // we are within the deferred time so skip the test
    return xit(...args);
  }

  return it(...args);
};

global.describeFailsFirefox = (...args) => {
  if (isFirefox) return xdescribe(...args);
  else return describe(...args);
};

global.describeChromeOnly = (...args) => {
  if (isChrome) return describe(...args);
};

if (process.env.COVERAGE) trackCoverage();

console.log(
  `Running unit tests with:
  -> product: ${product}
  -> binary: ${
    defaultBrowserOptions.executablePath ||
    path.relative(process.cwd(), puppeteer.executablePath())
  }`
);

exports.setupTestBrowserHooks = () => {
  before(async () => {
    const browser = await puppeteer.launch(defaultBrowserOptions);
    state.browser = browser;
  });

  after(async () => {
    await state.browser.close();
    state.browser = null;
  });
};

exports.setupTestPageAndContextHooks = () => {
  beforeEach(async () => {
    state.context = await state.browser.createIncognitoBrowserContext();
    state.page = await state.context.newPage();
  });

  afterEach(async () => {
    await state.context.close();
    state.context = null;
    state.page = null;
  });
};

before(async () => {
  const { server, httpsServer } = await setupServer();

  state.puppeteer = puppeteer;
  state.defaultBrowserOptions = defaultBrowserOptions;
  state.server = server;
  state.httpsServer = httpsServer;
  state.isFirefox = isFirefox;
  state.isChrome = isChrome;
  state.isHeadless = isHeadless;
  state.puppeteerPath = path.resolve(path.join(__dirname, '..'));
});

beforeEach(async () => {
  state.server.reset();
  state.httpsServer.reset();
});

after(async () => {
  await state.server.stop();
  state.server = null;
  await state.httpsServer.stop();
  state.httpsServer = null;
});

afterEach(() => {
  sinon.restore();
});
