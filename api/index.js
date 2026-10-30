'use strict';

// Vercel may provide either the browser URL or the internal rewrite URL.
// Reconstruct the original path only for the internal function entry point,
// retaining the original query string (e.g. /search?q=...).
const {handleRequest} = require('../server');

module.exports = function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/index' || url.pathname === '/api/index.js' || url.pathname === '/api') {
    const path = url.searchParams.get('__path');
    if (path && path.startsWith('/') && !path.startsWith('//')) {
      url.searchParams.delete('__path');
      const query = url.searchParams.toString();
      req.url = path + (query ? `?${query}` : '');
    }
  }
  return handleRequest(req, res);
};
