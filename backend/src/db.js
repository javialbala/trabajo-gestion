const { Pool } = require('pg');
require('dotenv').config();

// En un PaaS real, DATABASE_URL es inyectada automáticamente por la plataforma
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};