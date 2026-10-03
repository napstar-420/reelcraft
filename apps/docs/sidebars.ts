import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  guide: [
    'intro',
    {
      type: 'category',
      label: 'Install',
      collapsed: false,
      items: ['install-docker', 'run-reelcraft'],
    },
    {
      type: 'category',
      label: 'Set up',
      collapsed: false,
      items: ['provider-keys', 'browseros-neo', 'codex'],
    },
    {
      type: 'category',
      label: 'Look after it',
      collapsed: false,
      items: ['updating', 'backup', 'troubleshooting'],
    },
  ],
};

export default sidebars;
