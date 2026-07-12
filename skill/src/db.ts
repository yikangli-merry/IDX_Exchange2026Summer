import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";

type Env = Record<string, string | undefined>;

let pool: Pool | null = null;

function requiredEnv(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required to connect to the MLS MySQL database.`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3306;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MYSQL_PORT must be a valid TCP port.");
  }
  return port;
}

export function createMysqlPoolOptions(env: Env = process.env): PoolOptions {
  return {
    host: requiredEnv(env, "MYSQL_HOST"),
    port: parsePort(env.MYSQL_PORT),
    user: requiredEnv(env, "MYSQL_USER"),
    password: requiredEnv(env, "MYSQL_PASSWORD"),
    database: requiredEnv(env, "MYSQL_DATABASE"),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool(createMysqlPoolOptions());
  }
  return pool;
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, [...params]);
  return rows as T[];
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}
