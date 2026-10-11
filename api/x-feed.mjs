import { handleXFeed } from '../server/x-feed-service.mjs';

export default async function handler(req, res) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const response = await handleXFeed(new Request(`https://${req.headers.host}${req.url}`, { method: req.method, headers }));
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.end(await response.text());
}
