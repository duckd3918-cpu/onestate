declare const Editor: any;

import { getProjectSettings, toPackageConfig } from './core/settings';
import { packageForNetworks } from './core/packager/packager';
import { resolve } from 'path';

export async function onAfterBuild(options: any, result: any): Promise<void> {
  const pkgOptions = options.packages?.['plbx-cocos-extension'];
  const dest = result?.dest;

  // Always notify the panel about the build
  Editor.Message.send('plbx-cocos-extension', 'on-build-finished', {
    dest,
    platform: options?.platform,
  });

  // Auto-package if enabled in build settings
  if (!pkgOptions?.autoPackage) return;
  if (!dest) {
    return;
  }

  try {
    const settings = await getProjectSettings();
    const networks = settings.selectedNetworks;
    if (!networks?.length) {
      return;
    }

    const projectRoot = Editor.Project.path || '';
    const buildDir = dest; // use actual build output path
    const outputDir = resolve(projectRoot, settings.outputDir || 'build/plbx-html');

    // toPackageConfig carries loaderMode/legacyLoaderNetworks so the loader-engine
    // rollback path is honored in auto-package (not just manual packaging).
    const config = toPackageConfig(settings);


    const result = await packageForNetworks({
      buildDir,
      outputDir,
      networks,
      config,
      // Same Moloco launcher metadata as manual packaging (main.packageNetworks).
      templateVariables: {
        ...settings.templateVariables,
        ...(settings.molocoAssetProvider ? { assetProvider: settings.molocoAssetProvider } : {}),
        ...(settings.molocoAssetTitle ? { assetTitle: settings.molocoAssetTitle } : {}),
      },
      onProgress: (_id, _status, _msg) => {
      },
    });

    const passed = result.results.filter((r: any) => r.status === 'success').length;
    const failed = result.results.filter((r: any) => r.status === 'error').length;
    void passed; void failed;

    // Notify panel to refresh results
    Editor.Message.send('plbx-cocos-extension', 'on-auto-package-done', result);
  } catch (e: any) {
    void e;
  }
}
