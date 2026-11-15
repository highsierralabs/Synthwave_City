// Style plus the module boundaries of architecture.md section 3.2.
// Not type-aware on purpose: a sibling task's half-written file cannot break another task's lint.
import tseslint from 'typescript-eslint';

const LAYERS = ['sky', 'ground', 'buildings', 'streetlife', 'airtraffic', 'beams', 'holograms'];

const ENUM = { selector: 'TSEnumDeclaration', message: 'Use an `as const` object, not enum (Agents.md).' };

const three = (message, allowTypeImports = false) => ({ regex: '^three(/|$)', allowTypeImports, message });
const post = { regex: '^postprocessing(/|$)', message: 'Only src/post may import postprocessing (section 3.2).' };
/** Forbid reaching the named src folders through a relative path. */
const folders = (names, message) => ({ regex: `^(\\.\\./)+(${names.join('|')})(/|$)`, message });

const PURE = [
  { object: 'Math', property: 'random', message: 'core and city are deterministic: use src/core/random.ts.' },
  { object: 'Date', property: 'now', message: 'core and city are pure: no clocks.' },
];

function restrict(patterns) {
  return { 'no-restricted-imports': ['error', { patterns }] };
}

const layerBlocks = LAYERS.map((id) => ({
  files: [`src/layers/${id}/**/*.ts`],
  rules: restrict([
    post,
    folders(LAYERS.filter((other) => other !== id), 'A layer never imports another layer (section 3.2).'),
    folders(['post', 'audio', 'camera', 'app', 'engine', 'city'], 'Layers import only contracts, core and three (section 3.2).'),
  ]),
}));

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'shots/**', 'test-results/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': ['error', ENUM],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/contracts/**/*.ts'],
    rules: restrict([
      post,
      three('Contracts may import three for types only (section 3.2).', true),
      folders(['core', 'engine', 'city', 'post', 'layers', 'audio', 'camera', 'app'], 'Contracts import nothing from the project.'),
    ]),
  },
  {
    files: ['src/core/**/*.ts', 'src/city/**/*.ts'],
    rules: {
      ...restrict([
        post,
        three('core and city are pure: no three (section 3.2).'),
        folders(['engine', 'post', 'layers', 'audio', 'camera', 'app'], 'core and city import only contracts and core.'),
      ]),
      'no-restricted-properties': ['error', ...PURE],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: restrict([post, folders(['city', 'post', 'layers', 'audio', 'camera', 'app'], 'The engine reaches layers and the pipeline only through its lazy globs.')]),
  },
  {
    files: ['src/audio/**/*.ts', 'src/camera/**/*.ts'],
    rules: restrict([post, three('audio and camera do not use three.'), folders(['engine', 'city', 'post', 'layers', 'app'], 'Import only contracts and core here.')]),
  },
  {
    files: ['src/post/**/*.ts'],
    rules: restrict([folders(['engine', 'city', 'layers', 'audio', 'camera', 'app'], 'post imports only contracts, core, three and postprocessing.')]),
  },
  ...layerBlocks,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', Buffer: 'readonly' } },
  },
);
