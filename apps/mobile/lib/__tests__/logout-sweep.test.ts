jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    multiRemove: jest.fn(),
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));

import { PATIENT_SCOPED_CACHE_KEYS } from '../api';
import { PREGNANCY_DUE_DATE_KEY } from '../draft-keys';

/**
 * The registry logout actually sweeps.
 *
 * This file exists because a key can be perfectly well defined, tested
 * in isolation, and swept by nothing — which is what happened to the
 * pregnancy due date. It was declared beside the screen that writes it,
 * so nobody reviewing the sweep list ever saw it, and it survived
 * logout on a phone that in this disease is routinely shared between
 * affected family members.
 *
 * AsyncStorage is mocked only so lib/api.ts can be imported at all
 * under jest-expo; nothing here touches storage.
 */
describe('登出要清掉的患者数据', () => {
  it('孕期预产期在清扫列表里', () => {
    expect(PATIENT_SCOPED_CACHE_KEYS).toContain(PREGNANCY_DUE_DATE_KEY);
  });

  it('列表里没有重复项 —— 重复通常意味着有人各自加了一遍', () => {
    expect(new Set(PATIENT_SCOPED_CACHE_KEYS).size).toBe(PATIENT_SCOPED_CACHE_KEYS.length);
  });

  it('每一项都是 openrd 前缀的真实 key', () => {
    PATIENT_SCOPED_CACHE_KEYS.forEach((key) => {
      expect(typeof key).toBe('string');
      expect(key.startsWith('openrd.')).toBe(true);
    });
  });
});
