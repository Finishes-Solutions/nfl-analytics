import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  apiKey: req('BDL_API_KEY'),
  baseUrl: process.env.BDL_BASE_URL ?? 'https://api.balldontlie.io',
  rateLimitPerMin: Number(process.env.BDL_RATE_LIMIT_PER_MIN ?? 550),
  maxRetries: Number(process.env.BDL_MAX_RETRIES ?? 5),
  sql: {
    server: req('SQL_SERVER'),          // e.g. yourserver.database.windows.net
    database: req('SQL_DATABASE'),
    user: req('SQL_USER'),
    password: req('SQL_PASSWORD'),
  },
  backfill: {
    fromSeason: Number(process.env.BACKFILL_FROM ?? 2002),
    toSeason: Number(process.env.BACKFILL_TO ?? new Date().getFullYear()),
  },
};
