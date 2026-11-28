const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.get('/api/firebase-config', (req, res) => {
  const apiKey = process.env.FIREBASE_API_KEY || '';
  if (!apiKey) {
    return res.json({ configured: false });
  }

  return res.json({
    configured: true,
    config: {
      apiKey,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      databaseURL: process.env.FIREBASE_DATABASE_URL || '',
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || '',
      measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
    }
  });
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/exam', (req, res) => {
  res.sendFile(path.join(__dirname, 'exam.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`useas Courses server listening at http://${HOST}:${PORT}`);
});
