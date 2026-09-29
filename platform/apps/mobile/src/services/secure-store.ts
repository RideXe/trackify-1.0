// Small string key-value storage backed by the Android Keystore through react-native-keychain.
// Each key is stored as its own keychain "service".
import * as Keychain from 'react-native-keychain';

// No user authentication: background location uploads read these values with no UI available.
const storage = Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH;

export async function getItemAsync(key: string): Promise<string | null> {
  const entry = await Keychain.getGenericPassword({ service: key });
  return entry ? entry.password : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (!(await Keychain.setGenericPassword('trackify', value, { service: key, storage })))
    throw new Error('Unable to save to secure storage');
}

export async function deleteItemAsync(key: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: key });
}
