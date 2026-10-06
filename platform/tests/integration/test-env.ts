/** The integration suite never touches the development database. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://itsm:itsm@127.0.0.1:5432/itsm_test";

if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(`Refusing to run integration tests against a non-test database: ${TEST_DATABASE_URL}`);
}
