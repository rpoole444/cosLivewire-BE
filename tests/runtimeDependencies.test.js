const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

process.env.AWS_S3_BUCKET_NAME ||= 'runtime-dependency-test';
process.env.AWS_REGION ||= 'us-east-1';

const productionModules = [
  '../models/Event',
  '../routes/eventRouter',
  '../routes/artistRouter',
];

for (const modulePath of productionModules) {
  assert.doesNotThrow(
    () => require(modulePath),
    `Production module ${modulePath} must load from declared runtime dependencies`
  );
}

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const declaredDependencies = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {}),
]);
const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const productionEntries = [
  'app.js',
  'routes',
  'models',
  'middleware',
  'utils',
  'services',
  'scripts',
];
const productionFiles = [];

const collectJavaScriptFiles = (entry) => {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry)) {
      collectJavaScriptFiles(path.join(entry, name));
    }
    return;
  }
  if (entry.endsWith('.js')) productionFiles.push(entry);
};

for (const entry of productionEntries) {
  collectJavaScriptFiles(path.join(repoRoot, entry));
}

const importPatterns = [
  /require\(['"]([^'"]+)['"]\)/g,
  /from\s+['"]([^'"]+)['"]/g,
  /import\(['"]([^'"]+)['"]\)/g,
];
const undeclaredImports = [];

for (const file of productionFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('node:')
      ) {
        continue;
      }

      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (!declaredDependencies.has(packageName) && !nodeBuiltins.has(packageName)) {
        undeclaredImports.push(
          `${packageName} in ${path.relative(repoRoot, file)}`
        );
      }
    }
  }
}

assert.deepStrictEqual(
  undeclaredImports,
  [],
  `Production imports must be declared dependencies:\n${undeclaredImports.join('\n')}`
);

console.log('runtime dependency tests passed');
