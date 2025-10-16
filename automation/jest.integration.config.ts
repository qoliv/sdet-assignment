import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.int.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 600_000,
  collectCoverage: false,
  reporters: ['default'],
  maxWorkers: 1,
  globalSetup: '<rootDir>/jest.global-setup.ts',
  globalTeardown: '<rootDir>/jest.global-teardown.ts',
};

export default config;
