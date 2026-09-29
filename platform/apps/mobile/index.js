import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import App from './src/App';
import { LOCATION_TASK, handleLocationTask } from './src/tasks/location-task';

// Fixes from the Android location service arrive here, including while the app UI is closed.
AppRegistry.registerHeadlessTask(LOCATION_TASK, () => handleLocationTask);
AppRegistry.registerComponent(appName, () => App);
