import merge from 'lodash/merge';
import { appScenarios } from './scenarios';
import { PreparedApp } from '@ef4/test-support';
import QUnit from 'qunit';
const { module: Qmodule, test } = QUnit;

appScenarios
  .map('v2-addon', project => {
    let myV2Addon = project.addDevDependency('my-v2-addon', {
      files: {
        'addon-main.js': `
          const { addonV1Shim } = require('@embroider/util/shim');
          module.exports = addonV1Shim(__dirname);
        `,
        'index.js': `
          export function helloWorld() {
            return 'hello from my-v2-addon';
          }
        `,
        'second.js': `
          export function second() {
            return 'second from my-v2-addon';
          }
        `,
        'test-support.js': `
          export function testSupport() {
            return 'test-support from my-v2-addon';
          }
        `,
      },
    });
    myV2Addon.pkg['ember-addon'] = {
      version: 2,
      type: 'addon',
    };
    myV2Addon.linkDependency('@embroider/util', { baseDir: __dirname });

    project.linkDevDependency('ember-auto-import', { baseDir: __dirname });
    merge(project.files, {
      app: {
        lib: {
          'exercise.js': `
            import { helloWorld } from 'my-v2-addon';
            export function useHelloWorld() {
              return helloWorld();
            }
          `,
        },
      },
      tests: {
        unit: {
          'addon-test.js': `
            import { module, test } from 'qunit';
            import { useHelloWorld } from '@ef4/app-template/lib/exercise';
            import { testSupport } from 'my-v2-addon/test-support';

            module('Unit | v2-addon', function () {
              test('app can import JS from addon', function(assert) {
                assert.equal(useHelloWorld(), 'hello from my-v2-addon');
              });
              test('tests can import JS from addon', async function(assert) {
                assert.equal(testSupport(), 'test-support from my-v2-addon');
              });
            });
          `,
        },
      },
    });
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      let app: PreparedApp;
      hooks.before(async () => {
        app = await scenario.prepare();
      });
      test('npm run test', async function (assert) {
        let result = await app.execute('npm run test');
        assert.equal(result.exitCode, 0, result.output);
      });
    });
  });
