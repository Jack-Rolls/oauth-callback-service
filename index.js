// External OAuth Callback Service
// Deploy to Vercel or Google Cloud Run
// This replaces the problematic Lambda OAuth callback

import express from 'express';
import fetch from 'node-fetch';

const app = express();

// Parse JSON bodies
app.use(express.json());

// CORS for your frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.UI_BASE_URL || 'https://main.d3gsgaj7t4ywox.amplifyapp.com');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'external-oauth-callback',
    timestamp: new Date().toISOString()
  });
});

// OAuth callback endpoint
app.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  console.log('OAuth callback received:', { 
    hasCode: !!code, 
    hasState: !!state, 
    hasError: !!error,
    timestamp: new Date().toISOString()
  });

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=error&reason=${error}`);
  }

  // Check for authorization code
  if (!code) {
    console.error('No authorization code provided');
    return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=error&reason=missing_code`);
  }

  try {
    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI
    });

    console.log('Exchanging code for tokens...');
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString()
    });

    console.log('Google token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=error&reason=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    console.log('Token exchange successful');

    // Store tokens in AWS DynamoDB via internal API
    const storeResponse = await fetch(`${process.env.AWS_API_BASE_URL}/internal/store-google-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AWS_INTERNAL_API_KEY}`
      },
      body: JSON.stringify({
        userId: state, // Cognito user ID from state parameter
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        token_type: tokens.token_type
      })
    });

    if (!storeResponse.ok) {
      console.error('Failed to store tokens in AWS');
      return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=error&reason=storage_failed`);
    }

    console.log('Tokens stored successfully');
    
    // Redirect back to your app with success
    return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=google&ok=1`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(`${process.env.UI_BASE_URL}/settings?oauth=error&reason=exception`);
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 External OAuth callback service running on port ${PORT}`);
  console.log(`🔐 OAuth callback: http://localhost:${PORT}/oauth/callback`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

export default app;
