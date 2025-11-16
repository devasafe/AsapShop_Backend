// backend/config.js

const BASE_URL = 'https://asapshop-backend.onrender.com';
//const BASE_URL = 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const DEFAULT_IMAGE = 'https://i.pravatar.cc/150?u=default';

module.exports = {
  BASE_URL,
  FRONTEND_URL,
  DEFAULT_IMAGE
};
