// Jest setup file
// Set timezone for consistent testing
process.env.TZ = 'America/New_York';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};
