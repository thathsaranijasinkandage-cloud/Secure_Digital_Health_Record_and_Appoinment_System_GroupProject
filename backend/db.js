'use strict';
/**
 * db.js – Firebase Admin SDK initialiser
 *
 * Replaces the old better-sqlite3 / medix.db setup.
 * Every route file imports `{ db }` from here and calls
 * Firestore's async collection/document API instead of
 * synchronous SQLite prepared statements.
 *
 * Setup:
 *  1. Download your Firebase service-account JSON from the Firebase Console
 *     (Project Settings → Service Accounts → Generate new private key).
 *  2. Save it as  backend/serviceAccountKey.json  (never commit this file!).
 *  3. Set FIREBASE_SERVICE_ACCOUNT_PATH in your .env (defaults to the path above).
 */

require('dotenv').config();
const admin = require('firebase-admin');
const path  = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, 'serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
  });
}

const db = admin.firestore();

// Firestore collection references (mirrors the old SQLite table names)
const collections = {
  users          : db.collection('users'),
  appointments   : db.collection('appointments'),
  medicalRecords : db.collection('medical_records'),
  waitingList    : db.collection('waiting_list'),
  auditLogs      : db.collection('audit_logs'),
};

module.exports = { db, admin, collections };
