import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
    sizes: [128, 96, 48, 32, 24, 16],
  },
  manifest: {
    name: 'YOSO - Browser Workflow Recorder',
    description: 'Record, normalize, redact, and export browser workflows as versioned YOSO Trace Packages',
    permissions: [
      'activeTab',
      'sidePanel',
      'storage',
      'tabs',
      'scripting',
      'webNavigation',
    ],
    host_permissions: [
      '<all_urls>',
    ],
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    action: {
      default_title: 'YOSO',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
