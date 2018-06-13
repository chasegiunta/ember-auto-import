const Plugin = require('broccoli-plugin');
const walkSync = require('walk-sync');
const fs = require('fs');
const FSTree = require('fs-tree-diff');
const debug = require('debug')('ember-auto-import:analyzer');
const { Pipeline, File } = require('babel-core');
const babylon = require('babylon');
const symlinkOrCopy = require('symlink-or-copy');
const mkdirp = require('mkdirp');
const { join, dirname } = require('path');

/*
  Analyzer discovers and maintains info on all the module imports that
  appear in some number of broccoli trees.
*/
module.exports = class Analyzer  {
  // didAddTree is an optional callback that lets you hear when a new
  // tree is added. It receives the post-analyzed tree as an argument.
  constructor({ babelOptions, didAddTree }) {
    this._parserOptions = this._buildParserOptions(babelOptions);
    this._modules = Object.create(null);
    this._paths = Object.create(null);
    this._didAddTree = didAddTree;
  }

  _buildParserOptions(babelOptions) {
    debug("babel options %j", babelOptions);
    let p = new Pipeline();
    let f = new File(babelOptions, p);
    debug("parser options %j", f.parserOpts);
    return f.parserOpts;
  }

  // An Object that maps from module names to the list of relative
  // paths in which that module was imported. The relative paths will
  // be prefixed with each tree's label if you provide labels.
  get imports() {
    if (!this._modules) {
      this._modules = groupModules(this._paths);
      debug("imports %j", this._modules);
    }
    return this._modules;
  }

  // A pass-through broccoli transform that (as a side-effect)
  // analyzes all the Javascript in the tree for import
  // statements. You can provide a label to namespace this tree
  // relative to any other trees.
  analyzeTree(tree, label='') {
    let outputTree = new AnalyzerTransform(tree, label, this);
    if (this._didAddTree) {
      this._didAddTree(outputTree);
    }
    return outputTree;
  }
};

class AnalyzerTransform extends Plugin {
  constructor(inputTree, label, analyzer) {
    super([inputTree], {
      annotation: 'ember-auto-import-analyzer',
      persistentOutput: true
    });
    this._label = label;
    this._previousTree = new FSTree();
    this._analyzer = analyzer;
  }

  build() {
    this._getPatchset().forEach(([operation, relativePath]) => {
      let outputPath = join(this.outputPath, relativePath);

      switch (operation) {
      case 'unlink':
        this._removeImports(relativePath);
        fs.unlinkSync(outputPath);
        break;
      case 'rmdir' :
        fs.rmdirSync(outputPath);
        break;
      case 'mkdir' :
        fs.mkdirSync(outputPath);
        break;
      case 'create':
      case 'change':
        {
          let absoluteInputPath  = join(this.inputPaths[0], relativePath);
          this._updateImports(relativePath, fs.readFileSync(absoluteInputPath, 'utf8'));
          copy(absoluteInputPath, outputPath);
        }
      }
    });
  }

  _getPatchset() {
    let input = walkSync.entries(this.inputPaths[0], [ '**/*.js' ]);
    let previous  = this._previousTree;
    let next = this._previousTree = FSTree.fromEntries(input);
    return previous.calculatePatch(next);
  }

  _removeImports(relativePath) {
    let labeledPath = join(this._label, relativePath);
    debug(`removing imports for ${labeledPath}`);
    this._analyzer._paths[labeledPath] = null;
    this._analyzer._modules = null; // invalidates analyzer's cache
  }

  _updateImports(relativePath, source) {
    let labeledPath = join(this._label, relativePath);
    debug(`updating imports for ${labeledPath}, ${source.length}`);
    this._analyzer._paths[labeledPath] = this._parseImports(source);
    this._analyzer._modules = null; // invalidates analyzer's cache
  }

  _parseImports(source) {
    let ast = babylon.parse(source, this._analyzer._parserOptions);
    // No need to recurse here, because we only deal with top-level static import declarations
    return ast.program.body.filter(node => node.type === 'ImportDeclaration').map(node => node.source.value);
  }
}


function copy(sourcePath, destPath) {
  let destDir = dirname(destPath);

  try {
    symlinkOrCopy.sync(sourcePath, destPath);
  } catch (e) {
    if (!fs.existsSync(destDir)) {
      mkdirp.sync(destDir);
    }
    try {
      fs.unlinkSync(destPath);
    } catch (e) {
      // swallow the error
    }
    symlinkOrCopy.sync(sourcePath, destPath);
  }
}

function groupModules(paths) {
  let targets = Object.create(null);
  Object.keys(paths).forEach(inPath => {
    paths[inPath].forEach(module => {
      if (!targets[module]) {
        targets[module] = [];
      }
      targets[module].push(inPath);
    });
  });
  return targets;
}