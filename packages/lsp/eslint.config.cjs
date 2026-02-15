module.exports = {
  root: false,
  ignorePatterns: ['dist/**'],
  rules: {
    'max-lines': [
      'error',
      { code: 800, skipBlankLines: true, skipComments: true },
    ],
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
  },
};
