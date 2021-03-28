import merge from 'lodash/merge';
import { appScenarios } from './scenarios';
import { PreparedApp, Project } from 'scenario-tester';
import { setupFastboot } from './fastboot-helper';
import QUnit from 'qunit';
const { module: Qmodule, test } = QUnit;

function buildV2Addon() {
  let addon = new Project('my-v2-addon', {
    files: {
      'addon-main.js': `
        const { addonV1Shim } = require('@embroider/util/shim');
        module.exports = addonV1Shim(__dirname);
      `,
      'index.js': `
        export function helloUtil() {
          return 'hello-util-worked';
        }
      `,
      'test-support.js': `
        export function helloTestSupport() {
          return 'hello-test-support-worked';
        }
      `,
      app: {
        components: {
          'hello-world.js': `
            export { default } from 'my-v2-addon/components/hello';
          `,
        },
      },
      components: {
        'hello.js': `
          import { setComponentTemplate } from "@ember/component";
          import { precompileTemplate } from "@ember/template-compilation";
          import templateOnlyComponent from "@ember/component/template-only";

          export default setComponentTemplate(
            precompileTemplate(
              "<div data-test='my-v2-addon-hello'>Hello World</div>", {
                strictMode: true,
              }
            ),
            templateOnlyComponent()
          );
        `,
      },
    },
  });
  addon.linkDependency('@embroider/util', { baseDir: __dirname });
  addon.pkg.keywords = addon.pkg.keywords ? [...addon.pkg.keywords, 'ember-addon'] : ['ember-addon'];
  addon.pkg['ember-addon'] = {
    version: 2,
    type: 'addon',
    main: './addon-main.js',
    exports: {
      '.': 'index.js',
      './app/components/hello-world': './app/components/hello-world.js',
      './components/hello': './components/hello.js',
    },
    'app-js': {
      './components/hello-world.js': './app/components/hello-world.js',
    },
  };
  return addon;
}

let scenarios = appScenarios.map('v2-addon', project => {
  project.addDevDependency(buildV2Addon());

  merge(project.files, {
    app: {
      lib: {
        'exercise.js': `
            import { helloUtil } from 'my-v2-addon';
            export function useHelloUtil() {
              return helloUtil();
            }
          `,
      },
      helpers: {
        'have-runtime-module.js': `
          import { helper } from '@ember/component/helper';
          export default helper(function haveRuntimeModule([name]) {
            try {
              return Boolean(window.require(name));
            } catch (err) {
              return false;
            }
          });
        `,
      },
      templates: {
        'application.hbs': '{{outlet}}',
        'index.hbs': '<HelloWorld />',
        'check-contents.hbs': `
          <div data-test="my-v2-addon">{{have-runtime-module "my-v2-addon"}}</div>
          <div data-test="my-v2-addon/test-support">{{have-runtime-module "my-v2-addon/test-support"}}</div>
        `,
      },
      'router.js': `
        import EmberRouter from '@ember/routing/router';
        import config from './config/environment';

        const Router = EmberRouter.extend({
          location: config.locationType,
          rootURL: config.rootURL,
        });

        Router.map(function () {
          this.route('check-contents');
        });

        export default Router;
      `,
    },
    tests: {
      acceptance: {
        'index-test.js': `
            import { module, test } from 'qunit';
            import { visit } from '@ember/test-helpers';
            import { setupApplicationTest } from 'ember-qunit';

            module('Acceptance | index', function (hooks) {
              setupApplicationTest(hooks);

              test('can render component from v2 addon', async function (assert) {
                await visit('/');
                assert.equal(document.querySelector('[data-test="my-v2-addon-hello"]').textContent.trim(), 'Hello World');
              });
            });
          `,
      },
      unit: {
        'inner-module-test.js': `
            import { module, test } from 'qunit';
            import { useHelloUtil } from '@ef4/app-template/lib/exercise';
            import { helloTestSupport } from 'my-v2-addon/test-support';

            module('Unit | import from v2-addon', function () {
              test('can import from v2 addon top-level export', function (assert) {
                assert.equal(useHelloUtil(), 'hello-util-worked');
              });
              test('tests can import directly from another exported module', function (assert) {
                assert.equal(helloTestSupport(), 'hello-test-support-worked');
              });
            });
          `,
      },
    },
  });

  project.linkDependency('ember-auto-import', { baseDir: __dirname });
  project.linkDependency('ember-cli-fastboot', { baseDir: __dirname });
});

scenarios.forEachScenario(scenario => {
  Qmodule(scenario.name, function (hooks) {
    let app: PreparedApp;
    hooks.before(async () => {
      app = await scenario.prepare();
    });
    test('yarn test', async function (assert) {
      let result = await app.execute('npm run test');
      assert.equal(result.exitCode, 0, result.output);
    });
  });
});

scenarios
  .expand({
    'fastboot-dev': () => {},
    'fastboot-prod': () => {},
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      let visit: any;

      hooks.before(async () => {
        ({ visit } = await setupFastboot(
          await scenario.prepare(),
          scenario.name.endsWith('prod') ? 'production' : 'development'
        ));
      });

      test('component renders', async function (assert) {
        let dom = await visit('/');
        let document = dom.window.document;
        assert.equal(document.querySelector('[data-test="my-v2-addon-hello"]').textContent.trim(), 'Hello World');
      });

      test('app deps in app', async function (assert) {
        let dom = await visit('/check-contents');
        let document = dom.window.document;
        assert.equal(
          document.querySelector('[data-test="my-v2-addon"]').textContent.trim(),
          'true',
          'expected index to be present'
        );
      });

      test('no test deps in app', async function (assert) {
        let dom = await visit('/check-contents');
        let document = dom.window.document;
        assert.equal(
          document.querySelector('[data-test="my-v2-addon/test-support"]').textContent.trim(),
          'false',
          'expected test-support not to be present'
        );
      });
    });
  });
