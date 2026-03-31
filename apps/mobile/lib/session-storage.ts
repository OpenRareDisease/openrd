import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

let secureStoreAvailabilityPromise: Promise<boolean> | null = null;

const isSecureStoreAvailable = async () => {
  if (Platform.OS === 'web') {
    return false;
  }

  if (!secureStoreAvailabilityPromise) {
    secureStoreAvailabilityPromise = SecureStore.isAvailableAsync().catch(() => false);
  }

  return secureStoreAvailabilityPromise;
};

const requireSecureStore = async () => {
  const available = await isSecureStoreAvailable();
  if (!available) {
    throw new Error('Secure storage is unavailable on this device');
  }
  return SecureStore;
};

export const setSessionValue = async (key: string, value: string | null) => {
  if (Platform.OS === 'web') {
    if (value === null) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, value);
    }
    return;
  }

  const secureStore = await requireSecureStore();
  if (value === null) {
    await secureStore.deleteItemAsync(key);
  } else {
    await secureStore.setItemAsync(key, value);
  }
};

export const getSessionValue = async (key: string) => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  const secureStore = await requireSecureStore();
  return secureStore.getItemAsync(key);
};

export const removeSessionValue = async (key: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  const secureStore = await requireSecureStore();
  await secureStore.deleteItemAsync(key);
};
