import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    ignores: ['dist'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      'src/hooks/useAuth.tsx',
      'src/hooks/useInbox.tsx',
      'src/hooks/useJobs.tsx',
      'src/hooks/useMasterCv.tsx',
      'src/hooks/usePortalFeeds.tsx',
      'src/hooks/useSavedSearches.tsx',
      'src/hooks/useTailoredDocs.tsx',
      'src/hooks/useTailoring.tsx',
    ],
    rules: {
      // These context providers intentionally share modules with their consumer hooks.
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            'AuthProvider',
            'InboxProvider',
            'JobsProvider',
            'MasterCvProvider',
            'PortalFeedsProvider',
            'SavedSearchesProvider',
            'TailoredDocsProvider',
            'TailoringProvider',
          ],
        },
      ],
    },
  }
)
