import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import App from './src/App';
import { recordErrors } from './src/services/error-log';
import { LOCATION_TASK, handleLocationTask } from './src/tasks/location-task';

// An unexpected error is written to the tracker log first, so a crash leaves a trace.
recordErrors();

// Fixes from the Android location service arrive here, including while the app UI is closed.
AppRegistry.registerHeadlessTask(LOCATION_TASK, () => handleLocationTask);
AppRegistry.registerComponent(appName, () => App);
