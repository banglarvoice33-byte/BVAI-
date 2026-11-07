const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

function configured(): boolean {
  return Boolean(process.env.INDEXNOW_KEY && process.env.INDEXNOW_KEY_LOCATION);
}

export function indexNowConfigured(): boolean {
  return configured();
}

export function indexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  return key || null;
}

export function indexNowKeyLocation(): string | null {
  const location = process.env.INDEXNOW_KEY_LOCATION?.trim();
  return location || null;
}

export async function submitIndexNow(urlList: string[]): Promise<{ submitted: boolean; status?: number; reason?: string }> {
  const key = indexNowKey();
  const keyLocation = indexNowKeyLocation();
  const uniqueUrls = [...new Set(urlList.filter((url) => /^https:\/\//i.test(url)))].slice(0, 100);
  if (!key || !keyLocation) return { submitted: false, reason: 'indexnow_not_configured' };
  if (!uniqueUrls.length) return { submitted: false, reason: 'no_valid_urls' };

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(uniqueUrls[0]).host, key, keyLocation, urlList: uniqueUrls }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok
      ? { submitted: true, status: response.status }
      : { submitted: false, status: response.status, reason: 'indexnow_rejected' };
  } catch (error) {
    console.error('INDEXNOW_SUBMIT_FAILED', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { submitted: false, reason: 'indexnow_request_failed' };
  }
}
