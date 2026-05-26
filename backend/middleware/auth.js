'use strict';
/**
 * middleware/auth.js
 *
 * JWT verification + role-based authorisation.
 * Interface is identical to the old SQLite version so no route code changes
 * are needed except for the async Firestore calls inside routes.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

/**
 * authenticate – verifies Bearer JWT and attaches decoded payload to req.user.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
};

/**
 * authorize – restricts a route to one or more named roles.
 * Usage: router.get('/admin-only', authenticate, authorize('admin'), handler)
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. You do not have permission.' });
  }
  next();
};

module.exports = { authenticate, authorize };
