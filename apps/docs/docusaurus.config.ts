import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

// Published to https://napstar-420.github.io/reelcraft/docs/ by
// .github/workflows/docs.yml. The Pages root is kept for a future homepage.
const config: Config = {
  title: 'Reelcraft',
  tagline: 'Self-hosted AI video and reel generation',
  favicon: 'img/favicon.svg',
  url: 'https://napstar-420.github.io',
  baseUrl: '/reelcraft/docs/',
  organizationName: 'napstar-420',
  projectName: 'reelcraft',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/napstar-420/reelcraft/edit/main/apps/docs/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'Reelcraft',
      logo: { alt: '', src: 'img/favicon.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'guide', position: 'left', label: 'Guide' },
        {
          href: 'https://github.com/napstar-420/reelcraft/releases',
          label: 'Releases',
          position: 'right',
        },
        { href: 'https://github.com/napstar-420/reelcraft', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Guide',
          items: [
            { label: 'Install', to: '/install-docker' },
            { label: 'Update', to: '/updating' },
            { label: 'Troubleshooting', to: '/troubleshooting' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/napstar-420/reelcraft' },
            { label: 'Releases', href: 'https://github.com/napstar-420/reelcraft/releases' },
            { label: 'Docker Hub', href: 'https://hub.docker.com/r/zohaibkhan97/reelcraft' },
          ],
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'powershell'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
