const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * This app lives in the platform npm workspace: React Native and @trackify/api-client resolve from
 * the workspace root. The dashboard hoists a newer React there, while React Native must use the
 * exact React it was built against (installed under this app), so `react` always resolves here.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(workspaceRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'packages'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(
        moduleName === 'react' || moduleName.startsWith('react/')
          ? { ...context, originModulePath: path.join(projectRoot, 'index.js') }
          : context,
        moduleName,
        platform,
      ),
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
