export interface AppUser {
  id: string | null;
  displayName: string | null;
  givenName: string | null;
  email: string | null;
  photoURL: string | null;
}

let cachedAccessToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokenExpirationTime: number | null = null;

export const setGoogleTokens = (accessToken: string, refreshToken: string | null, expiresIn: number = 3500) => {
  cachedAccessToken = accessToken;
  if (refreshToken) cachedRefreshToken = refreshToken;
  tokenExpirationTime = Date.now() + expiresIn * 1000;
};

export const clearGoogleTokens = () => {
  cachedAccessToken = null;
  cachedRefreshToken = null;
  tokenExpirationTime = null;
};

export const getValidAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) return null;
  
  if (tokenExpirationTime && Date.now() > tokenExpirationTime - 60000) {
    if (!cachedRefreshToken) {
      clearGoogleTokens();
      return null;
    }
    try {
      const res = await fetch('/api/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cachedRefreshToken })
      });
      if (res.ok) {
        const data = await res.json();
        setGoogleTokens(data.accessToken, data.refreshToken, data.expiresIn || 3500);
        return data.accessToken;
      }
      clearGoogleTokens();
      return null;
    } catch (e) {
      console.error('Error refreshing token:', e);
      clearGoogleTokens();
      return null;
    }
  }
  return cachedAccessToken;
};

export const fetchGoogleUserProfile = async (token: string): Promise<AppUser | null> => {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const displayName = data.name || null;
      return {
        id: data.id || data.sub || data.email || null,
        displayName,
        givenName: data.given_name || displayName?.split(/\s+/)[0] || null,
        email: data.email || null,
        photoURL: data.picture || null,
      };
    }
  } catch (e) {
    console.error('Error fetching Google profile:', e);
  }
  return null;
};

export const signInWithGoogleLocal = (): Promise<{ accessToken: string, refreshToken: string, expiresIn?: number } | null> => {
  return new Promise((resolve, reject) => {
    fetch('/api/google/auth/url')
      .then(res => res.json())
      .then(data => {
        if (!data.url) throw new Error('No auth URL returned');
        localStorage.removeItem('orion_google_auth_pending');
        const authWindow = window.open(data.url, 'GoogleAuth', 'width=600,height=800');
        const finish = (value: { accessToken: string, refreshToken: string, expiresIn?: number } | null) => {
          cleanup();
          resolve(value);
        };
        const messageHandler = (event: MessageEvent) => {
          if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
            finish({
              accessToken: event.data.token,
              refreshToken: event.data.refreshToken,
              expiresIn: event.data.expiresIn,
            });
          }
        };
        window.addEventListener('message', messageHandler);
        const checkInterval = setInterval(() => {
          const pending = localStorage.getItem('orion_google_auth_pending');
          if (pending) {
            localStorage.removeItem('orion_google_auth_pending');
            try {
              const parsed = JSON.parse(pending);
              finish({
                accessToken: parsed.token,
                refreshToken: parsed.refreshToken,
                expiresIn: parsed.expiresIn,
              });
              if (authWindow && !authWindow.closed) authWindow.close();
            } catch (e) {
              cleanup();
              reject(e);
            }
            return;
          }
          if (authWindow?.closed) finish(null);
        }, 500);
        function cleanup() {
          clearInterval(checkInterval);
          window.removeEventListener('message', messageHandler);
        }
      })
      .catch(reject);
  });
};