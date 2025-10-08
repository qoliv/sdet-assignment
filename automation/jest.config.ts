import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.unit.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**'],
  coverageDirectory: 'coverage',
  reporters: ['default'],
};

export default config;
