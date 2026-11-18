import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', '*.config.js', 'babel.config.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
